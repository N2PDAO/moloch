const Moloch = artifacts.require('./Moloch')
const GuildBank = artifacts.require('./GuildBank')
const Token = artifacts.require('./Token')

console.log(process.env.target)
console.log(config)

import abi from 'web3-eth-abi';

import HttpProvider from `ethjs-provider-http`;
import EthRPC from `ethjs-rpc`;
const ethRPC = new EthRPC(new HttpProvider('http://localhost:8545'))

const BigNumber = web3.BigNumber
const BN = web3.utils.BN

const should = require('chai').use(require('chai-as-promised')).use(require('chai-bignumber')(BigNumber)).should()

const SolRevert = 'VM Exception while processing transaction: revert'

const zeroAddress = '0x0000000000000000000000000000000000000000'
const _1e18 = new BN('1000000000000000000') // 1e18


async function blockTime() {
  const block = await web3.eth.getBlock('latest')
  return block.timestamp
}

function getEventParams(tx, event) {
  if (tx.logs.length > 0) {
    for (let idx=0; idx < tx.logs.length; idx++) {
      if (tx.logs[idx].event == event) {
        return tx.logs[idx].args
      }
    }
  }
  return false
}

async function snapshot() {
  return new Promise((accept, reject) => {
    ethRPC.sendAsync({method: `evm_snapshot`}, (err, result)=> {
      if (err) {
        reject(err)
      } else {
        accept(result)
      }
    })
  })
}

async function restore(snapshotId) {
  return new Promise((accept, reject) => {
    ethRPC.sendAsync({method: `evm_revert`, params: [snapshotId]}, (err, result) => {
      if (err) {
        reject(err)
      } else {
        accept(result)
      }
    })
  })
}

async function forceMine() {
  return await ethRPC.sendAsync({method: `evm_mine`}, (err)=> {});
}

async function moveForwardPeriods(periods) {
  const blocktimestamp = await blockTime()
  const goToTime = config.PERIOD_DURATION_IN_SECONDS * periods
  await ethRPC.sendAsync({
    jsonrpc:'2.0', method: `evm_increaseTime`,
    params: [goToTime],
    id: 0
  }, (err)=> {`error increasing time`});
  await forceMine()
  const updatedBlocktimestamp = await blockTime()
  return true
}

let moloch, guildBank, token
//let proxyFactory, gnosisSafeMasterCopy, gnosisSafe, lw, executor
let proposal1, proposal2

// used by gnosis safe
const CALL = 0

const initSummonerBalance = 100


contract('Moloch', accounts => {
  let snapshotId

  // VERIFY SUBMIT PROPOSAL
  const verifySubmitProposal = async (proposal, proposalIndex, proposer, options) => {
    const initialTotalSharesRequested = options.initialTotalSharesRequested ? options.initialTotalSharesRequested : 0
    const initialTotalShares = options.initialTotalShares ? options.initialTotalShares : 0
    const initialProposalLength = options.initialProposalLength ? options.initialProposalLength : 0
    const initialMolochBalance = options.initialMolochBalance ? options.initialMolochBalance : 0
    const initialApplicantBalance = options.initialApplicantBalance ? options.initialApplicantBalance : 0
    const initialProposerBalance = options.initialProposerBalance ? options.initialProposerBalance : 0

    const expectedStartingPeriod = options.expectedStartingPeriod ? options.expectedStartingPeriod : 1

    const proposalData = await moloch.proposalQueue.call(proposalIndex)
    assert.equal(proposalData.proposer, proposer)
    assert.equal(proposalData.applicant, proposal.applicant)
    if (typeof proposal.sharesRequested == 'number') {
      assert.equal(proposalData.sharesRequested, proposal.sharesRequested)
    } else { // for testing overflow boundary with BNs
      assert(proposalData.sharesRequested.eq(proposal.sharesRequested))
    }
    assert.equal(proposalData.startingPeriod, expectedStartingPeriod)
    assert.equal(proposalData.yesVotes, 0)
    assert.equal(proposalData.noVotes, 0)
    assert.equal(proposalData.processed, false)
    assert.equal(proposalData.didPass, false)
    assert.equal(proposalData.aborted, false)
    assert.equal(proposalData.tokenTribute, proposal.tokenTribute)
    assert.equal(proposalData.details, proposal.details)
    assert.equal(proposalData.maxTotalSharesAtYesVote, 0)

    const totalSharesRequested = await moloch.totalSharesRequested()
    if (typeof proposal.sharesRequested == 'number') {
      assert.equal(totalSharesRequested, proposal.sharesRequested + initialTotalSharesRequested)
    } else { // for testing overflow boundary with BNs
      assert(totalSharesRequested.eq(proposal.sharesRequested.add(new BN(initialTotalSharesRequested))))
    }

    const totalShares = await moloch.totalShares()
    assert.equal(totalShares, initialTotalShares)

    const proposalQueueLength = await moloch.getProposalQueueLength()
    assert.equal(proposalQueueLength, initialProposalLength + 1)

    const molochBalance = await token.balanceOf(moloch.address)
    assert.equal(molochBalance, initialMolochBalance + proposal.tokenTribute + config.PROPOSAL_DEPOSIT)

    const applicantBalance = await token.balanceOf(proposal.applicant)
    assert.equal(applicantBalance, initialApplicantBalance - proposal.tokenTribute)

    const proposerBalance = await token.balanceOf(proposer)
    assert.equal(proposerBalance, initialProposerBalance - config.PROPOSAL_DEPOSIT)
  }
}
)
