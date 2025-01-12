const bn = require('bn.js')
const truffle_contract = require('truffle-contract')
const LinkToken_json = require('./LinkToken.json')

const bNToStringOrIdentity = (a) => (bn.isBN(a) ? a.toString() : a);
exports.wrappedERC20 = (contract) => ({
    ...contract,
    transfer: async (address, amount) => contract.transfer(address, bNToStringOrIdentity(amount)),
    transferAndCall: async (address, amount, payload, options) => contract.transferAndCall(address, bNToStringOrIdentity(amount), payload, options),
});
exports.linkContract = async (account) => {
    if (!account) {
        throw Error('No account supplied as a parameter');
    }
    const receipt = await web3.eth.sendTransaction({
        data: LinkToken_json.bytecode,
        from: account,
        gas: 2000000,
    });
    const contract = truffle_contract({ abi: LinkToken_json.abi });
    contract.setProvider(web3.currentProvider);
    contract.defaults({
        from: account,
        gas: 3500000,
        gasPrice: 10000000000,
    });
    return exports.wrappedERC20(await contract.at(receipt.contractAddress));
};
