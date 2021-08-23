const {
  balance,
  BN,
  constants,
  ether,
  expectEvent,
  expectRevert,
  time,
} = require('@openzeppelin/test-helpers');
const { tracker } = balance;
const { MAX_UINT256 } = constants;
const { latest } = time;
const abi = require('ethereumjs-abi');
const util = require('ethereumjs-util');
const utils = web3.utils;
const { expect } = require('chai');
const {
  DAI_TOKEN,
  DAI_PROVIDER,
  CHI_TOKEN,
  USDC_TOKEN,
} = require('./utils/constants');
const {
  evmRevert,
  evmSnapshot,
  mulPercent,
  profileGas,
  getHandlerReturn,
  getCallData,
  decodeInputData,
} = require('./utils/utils');
const fetch = require('node-fetch');
const queryString = require('query-string');

const HOneInch = artifacts.require('HOneInchV3');
const Registry = artifacts.require('Registry');
const Proxy = artifacts.require('ProxyMock');
const IToken = artifacts.require('IERC20');
const IOneInch = artifacts.require('IAggregationRouterV3');

const SELECTOR_1INCH_SWAP = '0x7c025200';
const SELECTOR_1INCH_UNOSWAP = '0x2e95b6c8';
/// Change url for different chain
/// - Ethereum: https://api.1inch.exchange/v3.0/1/
/// - Polygon: https://api.1inch.exchange/v3.0/137/
/// - BSC: https://api.1inch.exchange/v3.0/56/
const URL_1INCH = 'https://api.1inch.exchange/v3.0/1/';
const URL_1INCH_SWAP = URL_1INCH + 'swap';

const UNOSWAP_PROTOCOLS = ['SHIBASWAP', 'SUSHI', 'UNISWAP_V2'].join(',');
const NON_UNOSWAP_PROTOCOLS = [
  'CURVE_V2',
  'WETH',
  'CURVE',
  'UNISWAP_V1',
  'BALANCER',
  'BLACKHOLESWAP',
  'ONE_INCH_LP',
  'PMM2',
  'PMM3',
  'KYBER_DMM',
  'BALANCER_V2',
  'UNISWAP_V3',
].join(',');

contract('OneInchV3 Swap', function([_, user]) {
  let id;

  before(async function() {
    // ============= 1inch API Health Check =============
    const healthCkeck = await fetch(URL_1INCH + 'healthcheck');
    if (!healthCkeck.ok) {
      console.error(`=====> 1inch API not healthy now, skip the tests`);
      this.skip();
    }
    // ==================================================

    this.registry = await Registry.new();
    this.hOneInch = await HOneInch.new();
    await this.registry.register(
      this.hOneInch.address,
      utils.asciiToHex('OneInchV3')
    );
    this.proxy = await Proxy.new(this.registry.address);
  });

  beforeEach(async function() {
    id = await evmSnapshot();
  });

  afterEach(async function() {
    await evmRevert(id);
  });

  describe('Ether to Token', function() {
    const tokenAddress = DAI_TOKEN;
    const dummyTokenAddress = CHI_TOKEN;

    let balanceUser;
    let balanceProxy;
    let tokenUser;

    before(async function() {
      this.token = await IToken.at(tokenAddress);
    });

    beforeEach(async function() {
      balanceUser = await tracker(user);
      balanceProxy = await tracker(this.proxy.address);
      tokenUser = await this.token.balanceOf.call(user);
    });

    describe('Swap', function() {
      it('normal', async function() {
        // Prepare data
        const value = ether('0.1');
        const to = this.hOneInch.address;
        const slippage = 3;
        const swapReq = queryString.stringifyUrl({
          url: URL_1INCH_SWAP,
          query: {
            fromTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
            toTokenAddress: tokenAddress,
            amount: value,
            slippage: slippage,
            disableEstimate: true,
            fromAddress: this.proxy.address,
            // If the route contains only Uniswap and its' forks, tx.data will invoke `unoswap`
            protocols: NON_UNOSWAP_PROTOCOLS,
          },
        });

        // Call 1inch API
        const swapResponse = await fetch(swapReq);
        expect(swapResponse.ok, '1inch api response not ok').to.be.true;
        const swapData = await swapResponse.json();
        // Verify it's `swap` function call
        expect(swapData.tx.data.substring(0, 10)).to.be.eq(SELECTOR_1INCH_SWAP);
        const data = swapData.tx.data;
        const quote = swapData.toTokenAmount;

        // Execute
        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: value,
        });

        // Verify return value
        const tokenUserEnd = await this.token.balanceOf.call(user);
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );
        expect(handlerReturn).to.be.bignumber.eq(tokenUserEnd.sub(tokenUser));

        // Verify token balance
        expect(tokenUserEnd).to.be.bignumber.gte(
          // sub 1 more percent to tolerate the slippage calculation difference with 1inch
          tokenUser.add(mulPercent(quote, 100 - slippage - 1))
        );
        expect(await this.token.balanceOf.call(this.proxy.address)).to.be.zero;

        // Verify ether balance
        expect(await balanceProxy.get()).to.be.zero;
        expect(await balanceUser.delta()).to.be.bignumber.eq(
          ether('0')
            .sub(value)
            .sub(new BN(receipt.receipt.gasUsed))
        );

        profileGas(receipt);
      });

      it('msg.value greater than input ether amount', async function() {
        const value = ether('0.1');
        const to = this.hOneInch.address;
        const slippage = 3;

        const swapReq = queryString.stringifyUrl({
          url: URL_1INCH_SWAP,
          query: {
            fromTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
            toTokenAddress: tokenAddress,
            amount: value,
            slippage: slippage,
            disableEstimate: true,
            fromAddress: this.proxy.address,
            // If the route contains only Uniswap and its' forks, tx.data will invoke `unoswap`
            protocols: NON_UNOSWAP_PROTOCOLS,
          },
        });

        // Call 1inch API
        const swapResponse = await fetch(swapReq);
        expect(swapResponse.ok, '1inch api response not ok').to.be.true;
        const swapData = await swapResponse.json();
        // Verify it's `swap` function call
        expect(swapData.tx.data.substring(0, 10)).to.be.eq(SELECTOR_1INCH_SWAP);
        const data = swapData.tx.data;
        const quote = swapData.toTokenAmount;

        // Execute
        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: value.add(ether('1')),
        });

        // Verify return value
        const tokenUserEnd = await this.token.balanceOf.call(user);
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );
        expect(handlerReturn).to.be.bignumber.eq(tokenUserEnd.sub(tokenUser));

        // Verify token balance
        expect(tokenUserEnd).to.be.bignumber.gte(
          // sub 1 more percent to tolerate the slippage calculation difference with 1inch
          tokenUser.add(mulPercent(quote, 100 - slippage - 1))
        );
        expect(await this.token.balanceOf.call(this.proxy.address)).to.be.zero;

        // Verify ether balance
        expect(await balanceProxy.get()).to.be.zero;
        expect(await balanceUser.delta()).to.be.bignumber.eq(
          ether('0')
            .sub(value)
            .sub(new BN(receipt.receipt.gasUsed))
        );

        profileGas(receipt);
      });
    });

    describe('Unoswap', function() {
      // Prepare data
      it('normal', async function() {
        const value = ether('0.1');
        const to = this.hOneInch.address;
        const slippage = 3;
        const swapReq = queryString.stringifyUrl({
          url: URL_1INCH_SWAP,
          query: {
            fromTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
            toTokenAddress: tokenAddress,
            amount: value,
            slippage: slippage,
            disableEstimate: true,
            fromAddress: this.proxy.address,
            // If the route contains only Uniswap and its' forks, tx.data will invoke `unoswap`
            protocols: UNOSWAP_PROTOCOLS,
          },
        });

        // Call 1inch API
        const swapResponse = await fetch(swapReq);
        expect(swapResponse.ok, '1inch api response not ok').to.be.true;
        const swapData = await swapResponse.json();
        const quote = swapData.toTokenAmount;
        // Verify it's `unoswap` function call
        expect(swapData.tx.data.substring(0, 10)).to.be.eq(
          SELECTOR_1INCH_UNOSWAP
        );
        const data = swapData.tx.data;

        // Execute
        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: value,
        });

        // Verify return value
        const tokenUserEnd = await this.token.balanceOf.call(user);
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );
        expect(handlerReturn).to.be.bignumber.eq(tokenUserEnd.sub(tokenUser));

        // Verify token balance
        expect(tokenUserEnd).to.be.bignumber.gte(
          // sub 1 more percent to tolerate the slippage calculation difference with 1inch
          tokenUser.add(mulPercent(quote, 100 - slippage - 1))
        );
        expect(await this.token.balanceOf.call(this.proxy.address)).to.be.zero;

        // Verify ether balance
        expect(await balanceProxy.get()).to.be.zero;
        expect(await balanceUser.delta()).to.be.bignumber.eq(
          ether('0')
            .sub(value)
            .sub(new BN(receipt.receipt.gasUsed))
        );

        profileGas(receipt);
      });
    });
  });

  describe('Token to Ether', function() {
    const tokenAddress = DAI_TOKEN;
    const providerAddress = DAI_PROVIDER;

    let balanceUser;
    let balanceProxy;
    let tokenUser;

    before(async function() {
      this.token = await IToken.at(tokenAddress);
    });

    beforeEach(async function() {
      balanceUser = await tracker(user);
      balanceProxy = await tracker(this.proxy.address);
      tokenUser = await this.token.balanceOf.call(user);
    });

    describe('Swap', function() {
      it('normal', async function() {
        // Prepare data
        const value = ether('100');
        const to = this.hOneInch.address;
        const slippage = 3;
        const swapReq = queryString.stringifyUrl({
          url: URL_1INCH_SWAP,
          query: {
            fromTokenAddress: tokenAddress,
            toTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
            amount: value,
            slippage: slippage,
            disableEstimate: true,
            fromAddress: this.proxy.address,
            // If the route contains only Uniswap and its' forks, tx.data will invoke `unoswap`
            protocols: NON_UNOSWAP_PROTOCOLS,
          },
        });

        // Transfer from token to Proxy first
        await this.token.transfer(this.proxy.address, value, {
          from: providerAddress,
        });
        await this.proxy.updateTokenMock(this.token.address);

        // Call 1inch API
        const swapResponse = await fetch(swapReq);
        expect(swapResponse.ok, '1inch api response not ok').to.be.true;
        const swapData = await swapResponse.json();
        // Verify it's `swap` function call
        expect(swapData.tx.data.substring(0, 10)).to.be.eq(SELECTOR_1INCH_SWAP);
        const data = swapData.tx.data;
        const quote = swapData.toTokenAmount;

        // Execute
        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Verify return value
        const balanceUserDelta = await balanceUser.delta();
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );
        expect(handlerReturn).to.be.bignumber.eq(
          balanceUserDelta.add(new BN(receipt.receipt.gasUsed))
        );

        // Verify token balance
        expect(await this.token.balanceOf.call(user)).to.be.bignumber.eq(
          tokenUser
        );
        expect(await this.token.balanceOf.call(this.proxy.address)).to.be.zero;

        // Verify ether balance
        expect(await balanceProxy.get()).to.be.zero;
        expect(balanceUserDelta).to.be.bignumber.gte(
          ether('0')
            // sub 1 more percent to tolerate the slippage calculation difference with 1inch
            .add(mulPercent(quote, 100 - slippage - 1))
            .sub(new BN(receipt.receipt.gasUsed))
        );

        profileGas(receipt);
      });
    });

    describe('Unoswap', function() {
      it('normal', async function() {
        // Prepare data
        const value = ether('100');
        const to = this.hOneInch.address;
        const slippage = 3;
        const swapReq = queryString.stringifyUrl({
          url: URL_1INCH_SWAP,
          query: {
            fromTokenAddress: tokenAddress,
            toTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
            amount: value,
            slippage: slippage,
            disableEstimate: true,
            fromAddress: this.proxy.address,
            // If the route contains only Uniswap and its' forks, tx.data will invoke `unoswap`
            protocols: UNOSWAP_PROTOCOLS,
          },
        });

        // Transfer from token to Proxy first
        await this.token.transfer(this.proxy.address, value, {
          from: providerAddress,
        });
        await this.proxy.updateTokenMock(this.token.address);

        // Call 1inch API
        const swapResponse = await fetch(swapReq);
        expect(swapResponse.ok, '1inch api response not ok').to.be.true;
        const swapData = await swapResponse.json();
        const quote = swapData.toTokenAmount;
        // Verify it's `unoswap` function call
        expect(swapData.tx.data.substring(0, 10)).to.be.eq(
          SELECTOR_1INCH_UNOSWAP
        );
        const data = swapData.tx.data;

        // Execute
        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Verify return value
        const balanceUserDelta = await balanceUser.delta();
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );
        expect(handlerReturn).to.be.bignumber.eq(
          balanceUserDelta.add(new BN(receipt.receipt.gasUsed))
        );

        // Verify token balance
        expect(await this.token.balanceOf.call(user)).to.be.bignumber.eq(
          tokenUser
        );
        expect(await this.token.balanceOf.call(this.proxy.address)).to.be.zero;

        // Verify ether balance
        expect(await balanceProxy.get()).to.be.zero;
        expect(balanceUserDelta).to.be.bignumber.gte(
          ether('0')
            // sub 1 more percent to tolerate the slippage calculation difference with 1inch
            .add(mulPercent(quote, 100 - slippage - 1))
            .sub(new BN(receipt.receipt.gasUsed))
        );

        profileGas(receipt);
      });
    });
  });

  describe('Token to Token', function() {
    const token0Address = DAI_TOKEN;
    const token1Address = USDC_TOKEN;
    const providerAddress = DAI_PROVIDER;

    let balanceUser;
    let balanceProxy;
    let token0User;
    let token1User;

    before(async function() {
      this.token0 = await IToken.at(token0Address);
      this.token1 = await IToken.at(token1Address);
    });

    beforeEach(async function() {
      balanceUser = await tracker(user);
      balanceProxy = await tracker(this.proxy.address);
      token0User = await this.token0.balanceOf.call(user);
      token1User = await this.token1.balanceOf.call(user);
    });

    describe('Swap', function() {
      it('normal', async function() {
        // Prepare data
        const value = ether('100');
        const to = this.hOneInch.address;
        const slippage = 3;
        const swapReq = queryString.stringifyUrl({
          url: URL_1INCH_SWAP,
          query: {
            fromTokenAddress: token0Address,
            toTokenAddress: token1Address,
            amount: value,
            slippage: slippage,
            disableEstimate: true,
            fromAddress: this.proxy.address,
            // If the route contains only Uniswap and its' forks, tx.data will invoke `unoswap`
            protocols: NON_UNOSWAP_PROTOCOLS,
          },
        });

        // Transfer from token to Proxy first
        await this.token0.transfer(this.proxy.address, value, {
          from: providerAddress,
        });
        await this.proxy.updateTokenMock(this.token0.address);

        // Call 1inch API
        const swapResponse = await fetch(swapReq);
        expect(swapResponse.ok, '1inch api response not ok').to.be.true;
        const swapData = await swapResponse.json();
        // Verify it's `swap` function call
        expect(swapData.tx.data.substring(0, 10)).to.be.eq(SELECTOR_1INCH_SWAP);
        const data = swapData.tx.data;
        const quote = swapData.toTokenAmount;

        // Execute
        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Verify return value
        const token1UserEnd = await this.token1.balanceOf.call(user);
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );
        expect(handlerReturn).to.be.bignumber.eq(token1UserEnd.sub(token1User));

        // Verify token0 balance
        expect(await this.token0.balanceOf.call(user)).to.be.bignumber.eq(
          token0User
        );
        expect(await this.token0.balanceOf.call(this.proxy.address)).to.be.zero;

        // Verify token1 balance
        expect(await this.token1.balanceOf.call(user)).to.be.bignumber.gte(
          // sub 1 more percent to tolerate the slippage calculation difference with 1inch
          token1User.add(mulPercent(quote, 100 - slippage - 1))
        );
        expect(await this.token1.balanceOf.call(this.proxy.address)).to.be.zero;

        // Verify ether balance
        expect(await balanceProxy.get()).to.be.zero;
        expect(await balanceUser.delta()).to.be.bignumber.eq(
          ether('0').sub(new BN(receipt.receipt.gasUsed))
        );

        profileGas(receipt);
      });
    });

    describe('Unoswap', function() {
      it('normal', async function() {
        // Prepare data
        const value = ether('100');
        const to = this.hOneInch.address;
        const slippage = 3;
        const swapReq = queryString.stringifyUrl({
          url: URL_1INCH_SWAP,
          query: {
            fromTokenAddress: token0Address,
            toTokenAddress: token1Address,
            amount: value,
            slippage: slippage,
            disableEstimate: true,
            fromAddress: this.proxy.address,
            // If the route contains only Uniswap and its' forks, tx.data will invoke `unoswap`
            protocols: UNOSWAP_PROTOCOLS,
          },
        });

        // Transfer from token to Proxy first
        await this.token0.transfer(this.proxy.address, value, {
          from: providerAddress,
        });
        await this.proxy.updateTokenMock(this.token0.address);

        // Call 1inch API
        const swapResponse = await fetch(swapReq);
        expect(swapResponse.ok, '1inch api response not ok').to.be.true;
        const swapData = await swapResponse.json();
        const quote = swapData.toTokenAmount;
        // Verify it's `unoswap` function call
        expect(swapData.tx.data.substring(0, 10)).to.be.eq(
          SELECTOR_1INCH_UNOSWAP
        );
        const data = swapData.tx.data;

        // Execute
        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        // Verify return value
        const token1UserEnd = await this.token1.balanceOf.call(user);
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );
        expect(handlerReturn).to.be.bignumber.eq(token1UserEnd.sub(token1User));

        // Verify token0 balance
        expect(await this.token0.balanceOf.call(user)).to.be.bignumber.eq(
          token0User
        );
        expect(await this.token0.balanceOf.call(this.proxy.address)).to.be.zero;

        // Verify token1 balance
        expect(await this.token1.balanceOf.call(user)).to.be.bignumber.gte(
          // sub 1 more percent to tolerate the slippage calculation difference with 1inch
          token1User.add(mulPercent(quote, 100 - slippage - 1))
        );
        expect(await this.token1.balanceOf.call(this.proxy.address)).to.be.zero;

        // Verify ether balance
        expect(await balanceProxy.get()).to.be.zero;
        expect(await balanceUser.delta()).to.be.bignumber.eq(
          ether('0').sub(new BN(receipt.receipt.gasUsed))
        );

        profileGas(receipt);
      });
    });
  });
});
