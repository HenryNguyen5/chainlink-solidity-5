const h = require('chainlink').helpers
const l = require('./helpers/linkToken')
const { BN, expectRevert, time } = require('openzeppelin-test-helpers')
const maxUint256 = new BN('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

const encodeUint256 = int => {
  const zeros = '0000000000000000000000000000000000000000000000000000000000000000'
  const payload = int.toString(16)
  return (zeros + payload).slice(payload.length)
}

// eslint-disable-next-line no-unused-vars
const encodeInt256 = int => {
  if (int >= 0) {
    return encodeUint256(int)
  } else {
    const effs = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    const payload = maxUint256.plus(1).minus(Math.abs(int)).toString(16)
    return (effs + payload).slice(payload.length)
  }
}

// eslint-disable-next-line no-unused-vars
const evmTrue = 0x0000000000000000000000000000000000000000000000000000000000000001
// eslint-disable-next-line no-unused-vars
const evmFalse = 0x0000000000000000000000000000000000000000000000000000000000000000

contract('MyContract', accounts => {
  const Oracle = artifacts.require('Oracle.sol')
  const MyContract = artifacts.require('MyContract.sol')

  const defaultAccount = accounts[0]
  const oracleNode = accounts[1]
  const stranger = accounts[2]
  const consumer = accounts[3]

  // These parameters are used to validate the data was received
  // on the deployed oracle contract. The Job ID only represents
  // the type of data, but will not work on a public testnet.
  // For the latest JobIDs, visit our docs here:
  // https://docs.chain.link/docs/testnet-oracles
  const jobId = web3.utils.toHex('4c7b7ffb66b344fbaa64995af81e355a')
  const url =
    'https://min-api.cryptocompare.com/data/price?fsym=ETH&tsyms=USD,EUR,JPY'
  const path = 'USD'
  const times = 100

  // Represents 1 LINK for testnet requests
  const payment = web3.utils.toWei('1')

  let link, oc, cc

  beforeEach(async () => {
    link = await l.linkContract(defaultAccount)
    oc = await Oracle.new(link.address, { from: defaultAccount })
    cc = await MyContract.new(link.address, { from: consumer })
    await oc.setFulfillmentPermission(oracleNode, true, {
      from: defaultAccount
    })
  })

  describe('#createRequest', () => {
    context('without LINK', () => {
      it('reverts', async () => {
        await expectRevert.unspecified(
          cc.createRequestTo(oc.address, jobId, payment, url, path, times, {
            from: consumer
          })
        )
      })
    })

    context('with LINK', () => {
      let request

      beforeEach(async () => {
        await link.transfer(cc.address, web3.utils.toWei('1', 'ether'))
      })

      context('sending a request to a specific oracle contract address', () => {
        it('triggers a log event in the new Oracle contract', async () => {
          const tx = await cc.createRequestTo(
            oc.address,
            jobId,
            payment,
            url,
            path,
            times,
            { from: consumer }
          )
          request = h.decodeRunRequest(tx.receipt.rawLogs[3])
          assert.equal(oc.address, tx.receipt.rawLogs[3].address)
          assert.equal(
            request.topic,
            web3.utils.keccak256(
              'OracleRequest(bytes32,address,bytes32,uint256,address,bytes4,uint256,uint256,bytes)'
            )
          )
        })
      })
    })
  })

  describe('#fulfill', () => {
    const expected = 50000
    const response = '0x' + encodeUint256(expected)
    let request

    beforeEach(async () => {
      await link.transfer(cc.address, web3.utils.toWei('1', 'ether'))
      const tx = await cc.createRequestTo(
        oc.address,
        jobId,
        payment,
        url,
        path,
        times,
        { from: consumer }
      )
      request = h.decodeRunRequest(tx.receipt.rawLogs[3])
      await h.fulfillOracleRequest(oc, request, response, { from: oracleNode })
    })

    it('records the data given to it by the oracle', async () => {
      const currentPrice = await cc.data.call()
      assert.isTrue(new BN(currentPrice).eq(new BN(expected)))
    })

    context('when my contract does not recognize the request ID', () => {
      const otherId = web3.utils.toHex('otherId')

      beforeEach(async () => {
        request.id = otherId
      })

      it('does not accept the data provided', async () => {
        await expectRevert.unspecified(
          h.fulfillOracleRequest(oc, request, response, {
            from: oracleNode
          })
        )
      })
    })

    context('when called by anyone other than the oracle contract', () => {
      it('does not accept the data provided', async () => {
        await expectRevert.unspecified(
          cc.fulfill(request.id, response, { from: stranger })
        )
      })
    })
  })

  describe('#cancelRequest', () => {
    let request

    beforeEach(async () => {
      await link.transfer(cc.address, web3.utils.toWei('1', 'ether'))
      const tx = await cc.createRequestTo(
        oc.address,
        jobId,
        payment,
        url,
        path,
        times,
        { from: consumer }
      )
      request = h.decodeRunRequest(tx.receipt.rawLogs[3])
    })

    context('before the expiration time', () => {
      it('cannot cancel a request', async () => {
        await expectRevert(
          cc.cancelRequest(
            request.id,
            request.payment,
            request.callbackFunc,
            request.expiration,
            { from: consumer }
          ),
          'Request is not expired'
        )
      })
    })

    context('after the expiration time', () => {
      beforeEach(async () => {
        await time.increase(300)
      })

      context('when called by a non-owner', () => {
        it('cannot cancel a request', async () => {
          await expectRevert.unspecified(
            cc.cancelRequest(
              request.id,
              request.payment,
              request.callbackFunc,
              request.expiration,
              { from: stranger }
            )
          )
        })
      })

      context('when called by an owner', () => {
        it('can cancel a request', async () => {
          await cc.cancelRequest(
            request.id,
            request.payment,
            request.callbackFunc,
            request.expiration,
            { from: consumer }
          )
        })
      })
    })
  })

  describe('#withdrawLink', () => {
    beforeEach(async () => {
      await link.transfer(cc.address, web3.utils.toWei('1', 'ether'))
    })

    context('when called by a non-owner', () => {
      it('cannot withdraw', async () => {
        await expectRevert.unspecified(cc.withdrawLink({ from: stranger }))
      })
    })

    context('when called by the owner', () => {
      it('transfers LINK to the owner', async () => {
        const beforeBalance = await link.balanceOf(consumer)
        assert.equal(beforeBalance, '0')
        await cc.withdrawLink({ from: consumer })
        const afterBalance = await link.balanceOf(consumer)
        assert.equal(afterBalance, web3.utils.toWei('1', 'ether'))
      })
    })
  })
})
