/** Archived
const Registry = artifacts.require('Registry');
const Handler = artifacts.require('HMooniswap');
const utils = web3.utils;
*/

module.exports = async function(deployer) {
  /** Archived
  if (deployer.network === 'development') {
    return;
  }
  await deployer.deploy(Handler);
  const registry = await Registry.deployed();
  await registry.register(Handler.address, utils.asciiToHex('HMooniswap'));
*/
};
