const DSProxyRegistry = artifacts.require('IDSProxyRegistry');
const utils = ethers.utils;
const MAKER_PROXY_REGISTRY = '0x4678f0a6958e4d2bc4f1baf7bc52e8f3564f3fe4';

module.exports = async (hre) => {
  const { deployments } = hre;
  const { deploy } = deployments;
  const { deployer } = await hre.getNamedAccounts();

  await deploy('HBProtocol', {
    from: deployer,
    args: [],
    log: true,
  });

  const dsRegistry = await DSProxyRegistry.at(MAKER_PROXY_REGISTRY);
  const registry = await hre.ethers.getContract('Registry', deployer);
  const proxy = await hre.ethers.getContract('Proxy', deployer);
  const hBProtocol = await hre.ethers.getContract('HBProtocol', deployer);
  
  await registry.register(hBProtocol.address, utils.hexlify(utils.formatBytes32String('HBProtocol')));
  if(await dsRegistry.proxies.call(proxy.address) === "0x0000000000000000000000000000000000000000") 
      await dsRegistry.build(proxy.address);

  console.log('dsproxy: ' + (await dsRegistry.proxies.call(proxy.address)));
};
