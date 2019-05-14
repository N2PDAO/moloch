
const Moloch = artifacts.require('./Moloch')
const GuildBank = artifacts.require('./GuildBank')
const Token = artifacts.require('./Token')

const config = require('../migrations/config.json').test

let moloch, guildBank, token

/// define vars for RPC Control

const abi = require('web3-eth-abi')

const HttpProvider = require(`ethjs-provider-http`)
const EthRPC = require(`ethjs-rpc`)
const ethRPC = new EthRPC(new HttpProvider('http://localhost:8545'))

const BigNumber = web3.BigNumber
const BN = web3.utils.BN

const should = require('chai').use(require('chai-as-promised')).use(require('chai-bignumber')(BigNumber)).should()

const SolRevert = 'VM Exception while processing transaction: revert'


/// Helper functions for EthRPC

async function blockTime() {
  const block = await web3.eth.getBlock('latest')
  return block.timestamp
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


////////The TEST


contract("Moloch", async accounts => {

  // VERIFY PROCESS PROPOSAL - note: doesnt check forced reset of delegate key
  const verifyProcessProposal = async (proposal, proposalIndex, proposer, processor, options) => {
    const initialTotalSharesRequested = options.initialTotalSharesRequested ? options.initialTotalSharesRequested : 0
    const initialTotalShares = options.initialTotalShares ? options.initialTotalShares : 0
    const initialApplicantShares = options.initialApplicantShares ? options.initialApplicantShares : 0 // 0 means new member, > 0 means existing member
    const initialMolochBalance = options.initialMolochBalance ? options.initialMolochBalance : 0
    const initialGuildBankBalance = options.initialGuildBankBalance ? options.initialGuildBankBalance : 0
    const initialApplicantBalance = options.initialApplicantBalance ? options.initialApplicantBalance : 0
    const initialProposerBalance = options.initialProposerBalance ? options.initialProposerBalance : 0
    const initialProcessorBalance = options.initialProcessorBalance ? options.initialProcessorBalance : 0
    const expectedYesVotes = options.expectedYesVotes ? options.expectedYesVotes : 0
    const expectedNoVotes = options.expectedNoVotes ? options.expectedNoVotes : 0
    const expectedMaxSharesAtYesVote = options.expectedMaxSharesAtYesVote ? options.expectedMaxSharesAtYesVote : 0
    const expectedFinalTotalSharesRequested = options.expectedFinalTotalSharesRequested ? options.expectedFinalTotalSharesRequested : 0
    const didPass = typeof options.didPass == 'boolean' ? options.didPass : true
    const aborted = typeof options.aborted == 'boolean' ? options.aborted : false

    const proposalData = await moloch.proposalQueue.call(proposalIndex)
    assert.equal(proposalData.yesVotes, expectedYesVotes)
    assert.equal(proposalData.noVotes, expectedNoVotes)
    assert.equal(proposalData.maxTotalSharesAtYesVote, expectedMaxSharesAtYesVote)
    assert.equal(proposalData.processed, true)
    assert.equal(proposalData.didPass, didPass)
    assert.equal(proposalData.aborted, aborted)

    const totalSharesRequested = await moloch.totalSharesRequested()
    assert.equal(totalSharesRequested, expectedFinalTotalSharesRequested)

    const totalShares = await moloch.totalShares()
    assert.equal(totalShares, didPass && !aborted ? initialTotalShares + proposal.sharesRequested : initialTotalShares)

    const molochBalance = await token.balanceOf(moloch.address)
    assert.equal(molochBalance, initialMolochBalance - proposal.tokenTribute - config.PROPOSAL_DEPOSIT)

    const guildBankBalance = await token.balanceOf(guildBank.address)
    assert.equal(guildBankBalance, didPass && !aborted ? initialGuildBankBalance + proposal.tokenTribute : initialGuildBankBalance)

    // proposer and applicant are different
    if (proposer != proposal.applicant) {
      const applicantBalance = await token.balanceOf(proposal.applicant)
      assert.equal(applicantBalance, didPass && !aborted ? initialApplicantBalance : initialApplicantBalance + proposal.tokenTribute)

      const proposerBalance = await token.balanceOf(proposer)
      //assert.equal(proposerBalance, initialProposerBalance + config.PROPOSAL_DEPOSIT - config.PROCESSING_REWARD) //put in later

    // proposer is applicant
    } else {
      const proposerBalance = await token.balanceOf(proposer)
      const expectedBalance = didPass && !aborted
        ? initialProposerBalance + config.PROPOSAL_DEPOSIT - config.PROCESSING_REWARD
        : initialProposerBalance + config.PROPOSAL_DEPOSIT - config.PROCESSING_REWARD  + proposal.tokenTribute
      assert.equal(proposerBalance, expectedBalance)
    }

    const processorBalance = await token.balanceOf(processor)
    assert.equal(processorBalance, initialProcessorBalance + config.PROCESSING_REWARD)

    if (didPass && !aborted) {
      // existing member
      if (initialApplicantShares > 0) {
        const memberData = await moloch.members(proposal.applicant)
        assert.equal(memberData.shares, proposal.sharesRequested + initialApplicantShares)

      // new member
      } else {
        const newMemberData = await moloch.members(proposal.applicant)
        assert.equal(newMemberData.delegateKey, proposal.applicant)
        assert.equal(newMemberData.shares, proposal.sharesRequested)
        assert.equal(newMemberData.exists, true)
        assert.equal(newMemberData.highestIndexYesVote, 0)

        const newMemberAddressByDelegateKey = await moloch.memberAddressByDelegateKey(proposal.applicant)
        assert.equal(newMemberAddressByDelegateKey, proposal.applicant)
      }
    }
  }

  // VERIFY SUBMIT VOTE
  const verifySubmitVote = async (proposal, proposalIndex, memberAddress, expectedVote, options) => {
    const initialYesVotes = options.initialYesVotes ? options.initialYesVotes : 0
    const initialNoVotes = options.initialNoVotes ? options.initialNoVotes : 0
    const expectedMaxSharesAtYesVote = options.expectedMaxSharesAtYesVote ? options.expectedMaxSharesAtYesVote : 0

    const proposalData = await moloch.proposalQueue.call(proposalIndex)
    assert.equal(proposalData.yesVotes, initialYesVotes + (expectedVote == 1 ? 1 : 0))
    assert.equal(proposalData.noVotes, initialNoVotes + (expectedVote == 1 ? 0 : 1))
    assert.equal(proposalData.maxTotalSharesAtYesVote, expectedMaxSharesAtYesVote)

    const memberVote = await moloch.getMemberProposalVote(memberAddress, proposalIndex)
    assert.equal(memberVote, expectedVote)
  }

//// Verification of Proposals
//// This Function is called from varios places

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

  const verifyDelegation = async (sender, sender_shares, delegate, delegate_delegated_shares, amount_of_shares) =>{
    const _sender = sender;
    const _sender_shares = sender_shares;
    const _delegate = delegate;
    const _delegate_delegated_shares = delegate_delegated_shares;
    const _amount_of_shares = amount_of_shares;

    const sender_memberData = await moloch.members(sender)

    const sender_delegated_shares = await moloch.getSharesDelegated(delegate)

    assert.equal(sender_memberData.exists, true) //checks if member is existing
    assert.equal(sender_memberData.delegateKey, sender)   /// check if right adress
    assert.equal(sender_memberData.shares, sender_shares - amount_of_shares)   /// check if shares are taken out of account
    assert.equal(sender_delegated_shares, amount_of_shares) // need to check sharesDelegated

    const delegate_memberData = await moloch.members(delegate)

    assert.equal(delegate_memberData.exists, true) //checks if member is existing
    assert.equal(delegate_memberData.delegatekey, delegate) // checks if right address
    assert.equal(delegate_memberData.delegatedShares, Number(delegate_delegated_shares) + Number(amount_of_shares)) //check if shares are delegated

    assert.equal(Number(delegate_memberData.delegatedShares), Number(sender_delegated_shares)) /// this will fail if there are more than one delegate


  }

//// start here
  beforeEach(async() =>{
    snapshotId = await snapshot()

  })


  afterEach(async () => {
      await restore(snapshotId)
    })


  beforeEach("deploy contracts", async () => {
    moloch = await Moloch.deployed()
    const guildBankAddress = await moloch.guildBank()
    guildBank = await GuildBank.at(guildBankAddress)
    token = await Token.deployed()

    proposal1 = {
      applicant: accounts[1],
      tokenTribute: 100,
      sharesRequested: 1,
      details: "all hail moloch"
    }

  })
  it('verify deployment parameters', async () => {
    const now = await blockTime() 

    const approvedTokenAddress = await moloch.approvedToken()
    assert.equal(approvedTokenAddress, token.address)

    const guildBankAddress = await moloch.guildBank()
    assert.equal(guildBankAddress, guildBank.address)

    const guildBankOwner = await guildBank.owner()
    assert.equal(guildBankOwner, moloch.address)

    const guildBankToken = await guildBank.approvedToken()
    assert.equal(guildBankToken, token.address)

    const periodDuration = await moloch.periodDuration()
    assert.equal(+periodDuration, config.PERIOD_DURATION_IN_SECONDS)

    const votingPeriodLength = await moloch.votingPeriodLength()
    assert.equal(+votingPeriodLength, config.VOTING_DURATON_IN_PERIODS)

    const gracePeriodLength = await moloch.gracePeriodLength()
    assert.equal(+gracePeriodLength, config.GRACE_DURATON_IN_PERIODS)

    const abortWindow = await moloch.abortWindow()
    assert.equal(+abortWindow, config.ABORT_WINDOW_IN_PERIODS)

    const proposalDeposit = await moloch.proposalDeposit()
    assert.equal(+proposalDeposit, config.PROPOSAL_DEPOSIT)

    const dilutionBound = await moloch.dilutionBound()
    assert.equal(+dilutionBound, config.DILUTION_BOUND)

    const processingReward = await moloch.processingReward()
    assert.equal(+processingReward, config.PROCESSING_REWARD)

    const currentPeriod = await moloch.getCurrentPeriod()
    assert.equal(+currentPeriod, 0)

    const summonerData = await moloch.members(config.SUMMONER)
    assert.equal(summonerData.delegateKey.toLowerCase(), config.SUMMONER) // delegateKey matches
    assert.equal(summonerData.shares, 1)
    assert.equal(summonerData.exists, true)
    assert.equal(summonerData.highestIndexYesVote, 0)

    const summonerAddressByDelegateKey = await moloch.memberAddressByDelegateKey(config.SUMMONER)
    assert.equal(summonerAddressByDelegateKey.toLowerCase(), config.SUMMONER)

    const totalShares = await moloch.totalShares()
    assert.equal(+totalShares, 1)

    // confirm initial token supply and summoner balance
    const tokenSupply = await token.totalSupply()
    assert.equal(+tokenSupply.toString(), config.TOKEN_SUPPLY)
    //// WHY?
    const summonerBalance = await token.balanceOf(summoner)
    assert.equal(+summonerBalance.toString(), SummonerBalance)
    const creatorBalance = await token.balanceOf(creator)
    assert.equal(creatorBalance, config.TOKEN_SUPPLY - initSummonerBalance)
  })

  it("check token balance of account one", async () => {
    let balance = await token.balanceOf(accounts[0]);
    assert.equal(balance.valueOf(), config.TOKEN_SUPPLY);
  });

describe('submitProposal', () => {
  it("submit membership proposal happy case", async () => {

    await token.transfer(proposal1.applicant, proposal1.tokenTribute, { from: accounts[0] })  /// just for testcase... send applicant token to use for tribute
    await token.approve(moloch.address, 10, { from: accounts[0] })   ///deposit

    await token.approve(moloch.address, proposal1.tokenTribute, { from: proposal1.applicant }) /// prepare the tribute from applicant

    let balance = await token.balanceOf(accounts[0]);

    await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details, { from: accounts[0] })   ///summoner
    await verifySubmitProposal(proposal1, 0, accounts[0], {
       initialTotalShares: 1,
       initialApplicantBalance: proposal1.tokenTribute,
       initialProposerBalance: balance
     })
   })
  })


  describe('submitVote', () => {
    beforeEach(async () => {
      await token.transfer(proposal1.applicant, proposal1.tokenTribute, { from: accounts[0] })
      await token.approve(moloch.address, 10, { from: accounts[0] })
      await token.approve(moloch.address, proposal1.tokenTribute, { from: proposal1.applicant })   // tokenTribute
      await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details, { from:  accounts[0] })
    })

    it('happy case - yes vote', async () => {
      await moveForwardPeriods(1)
      await moloch.submitVote(0, 1, { from: accounts[0] })
      await verifySubmitVote(proposal1, 0, accounts[0], 1, {
        expectedMaxSharesAtYesVote: 1
      })
    })

    it('happy case - no vote', async () => {
      await moveForwardPeriods(1)
      await moloch.submitVote(0, 2, { from: accounts[0] })
      await verifySubmitVote(proposal1, 0, accounts[0], 2, {})
    })

    it('require fail - proposal does not exist', async () => {
      await moveForwardPeriods(1)
      await moloch.submitVote(1, 1, { from:  accounts[0] }).should.be.rejectedWith('proposal does not exist')
    })

    it('require fail - voting period has not started', async () => {
      // don't move the period forward
      await moloch.submitVote(0, 1, { from: accounts[0] }).should.be.rejectedWith('voting period has not started')
    })

})

describe('processProposal', () => {
  beforeEach(async () => {
    await token.transfer(proposal1.applicant, proposal1.tokenTribute, { from: accounts[0] })
    await token.approve(moloch.address, 10, { from: accounts[0] })
    await token.approve(moloch.address, proposal1.tokenTribute, { from: proposal1.applicant })

    await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details, { from: accounts[0] })

    await moveForwardPeriods(1)
    await moloch.submitVote(0, 1, { from: accounts[0] })

    await moveForwardPeriods(config.VOTING_DURATON_IN_PERIODS)
  })

  it('happy case', async () => {
    const balance = await token.balanceOf(accounts[0]).toString(10);
    console.log(balance)
    await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS)
    await moloch.processProposal(0, { from: accounts[9]})
    await verifyProcessProposal(proposal1, 0, accounts[0], accounts[9], {
      initialTotalSharesRequested: 1,
      initialTotalShares: 1,
      initialMolochBalance: 110,
      initialProposerBalance: 100 - config.PROPOSAL_DEPOSIT,
      expectedYesVotes: 1,
      expectedMaxSharesAtYesVote: 1
    })
  })

  it('require fail - proposal does not exist', async () => {
    await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS)
    await moloch.processProposal(1).should.be.rejectedWith('proposal does not exist')
  })

  it('require fail - proposal is not ready to be processed', async () => {
    await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS - 1)
    await moloch.processProposal(0).should.be.rejectedWith('proposal is not ready to be processed')
  })

  it('require fail - proposal has already been processed', async () => {
    await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS)
    await moloch.processProposal(0, { from: accounts[9]})
    await moloch.processProposal(0).should.be.rejectedWith('proposal has already been processed')
  })
})

describe('delegateShares', () => {
  beforeEach(async () => {
    await token.transfer(proposal1.applicant, proposal1.tokenTribute, { from: accounts[0] })
    await token.approve(moloch.address, 10, { from: accounts[0] })
    await token.approve(moloch.address, proposal1.tokenTribute, { from: proposal1.applicant })

    await moloch.submitProposal(proposal1.applicant, proposal1.tokenTribute, proposal1.sharesRequested, proposal1.details, { from: accounts[0] })

    await moveForwardPeriods(1)
    // await moloch.submitVote(0, 1, { from: accounts[0] })
    // await verifySubmitVote(proposal1, 0, accounts[0], 1, {
    //   expectedMaxSharesAtYesVote: 1
    // })
    await moveForwardPeriods(config.VOTING_DURATON_IN_PERIODS)
    await moveForwardPeriods(config.GRACE_DURATON_IN_PERIODS)
    // await moloch.processProposal(0, { from: accounts[9]})
    await moveForwardPeriods(config.VOTING_DURATON_IN_PERIODS)
  })

  it('happy case - delegation', async () => {
    const sender_before = await moloch.members(accounts[0])
    const delegate_before = await moloch.members(accounts[1])
    await moloch.delegateShares(accounts[1], 1, { from: accounts[0] })
    await verifyDelegation(accounts[0],sender_before.shares,accounts[1],delegate_before.delegatedShares,1)
  })

  it('require fail - more shares ask', async () => {
    await moloch.delegateShares(accounts[1], 2, { from: accounts[0] }).should.be.rejectedWith('attempting to delegate more shares than you own')
  })

  it('require fail - zero adress', async () => {
    const zeroAddress = '0x0000000000000000000000000000000000000000'
    await moloch.delegateShares(zeroAddress, 2, { from: accounts[0] }).should.be.rejectedWith('delegate cannot be 0')
  })

  it('member can vote with only delegated shares after ragequitting', async () => {
    const sender_before = await moloch.members(accounts[0])
    const delegate_before = await moloch.members(accounts[1])
    await moloch.delegateShares(accounts[1], 10, { from: accounts[0] })
    await verifyDelegation(accounts[0],sender_before.shares,accounts[1],delegate_before.delegatedShares,10)
    console.log(delegate_before.shares)
    await moloch.ragequit(delegate_before.shares,{from:delegate_before})
    expect(delegate_before.shares).to.equal(0)
    await moloch.submitVote(0, 1, { from: accounts[0] })
    await verifySubmitVote(proposal1, 0, accounts[0], 1, {
      expectedMaxSharesAtYesVote: 1
    })
    // if fails doesnt work 
    // check delegated shares has gone down 
  })

  it('member cannot delegate votes after ragequitting', async () => {
    const sender_before = await moloch.members(accounts[0])
    const delegate_before = await moloch.members(accounts[1])
    await moloch.ragequit(delegate_before.shares,{from:delegate_before})
    expect(delegate_before.shares).to.equal(0)
    expect(moloch.delegateShares
      (sender_before, 
       10, 
       {from: delegate_before}
    )).to.be.rejected    
  })

  it('member can delegate to member who has ragequit', async () => {

  })
  
})





////////
});
