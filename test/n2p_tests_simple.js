
const Moloch = artifacts.require('./Moloch')
const GuildBank = artifacts.require('./GuildBank')
const Token = artifacts.require('./Token')

const config = require('../migrations/config.json').test

let moloch, guildBank, token

contract("Moloch", async accounts => {

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

//// start here

  before("deploy contracts", async () => {
    moloch = await Moloch.deployed()
    const guildBankAddress = await moloch.guildBank()
    guildBank = await GuildBank.at(guildBankAddress)
    token = await Token.deployed()
  })
  it('verify deployment parameters', async () => {
    //const now = await blockTime()

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
    // const summonerBalance = await token.balanceOf(summoner)
    // assert.equal(+summonerBalance.toString(), SummonerBalance)
    // const creatorBalance = await token.balanceOf(creator)
    // assert.equal(creatorBalance, config.TOKEN_SUPPLY - initSummonerBalance)
  })

  it("check token balance of account one", async () => {
    let balance = await token.balanceOf(accounts[0]);
    assert.equal(balance.valueOf(), config.TOKEN_SUPPLY);
  });

  it("submit membership proposal happy case", async () => {
    proposal1 = {
      applicant: accounts[1],
      tokenTribute: 100,
      sharesRequested: 1,
      details: "all hail moloch"
    }
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
/*
  it("should call a function that depends on a linked library", async () => {
    let meta = await MetaCoin.deployed();
    let outCoinBalance = await meta.getBalance.call(accounts[0]);
    let metaCoinBalance = outCoinBalance.toNumber();
    let outCoinBalanceEth = await meta.getBalanceInEth.call(accounts[0]);
    let metaCoinEthBalance = outCoinBalanceEth.toNumber();
    assert.equal(metaCoinEthBalance, 2 * metaCoinBalance);
  });

  it("should send coin correctly", async () => {
    // Get initial balances of first and second account.
    let account_one = accounts[0];
    let account_two = accounts[1];

    let amount = 10;

    let instance = await MetaCoin.deployed();
    let meta = instance;

    let balance = await meta.getBalance.call(account_one);
    let account_one_starting_balance = balance.toNumber();

    balance = await meta.getBalance.call(account_two);
    let account_two_starting_balance = balance.toNumber();
    await meta.sendCoin(account_two, amount, { from: account_one });

    balance = await meta.getBalance.call(account_one);
    let account_one_ending_balance = balance.toNumber();

    balance = await meta.getBalance.call(account_two);
    let account_two_ending_balance = balance.toNumber();

    assert.equal(
      account_one_ending_balance,
      account_one_starting_balance - amount,
      "Amount wasn't correctly taken from the sender"
    );
    assert.equal(
      account_two_ending_balance,
      account_two_starting_balance + amount,
      "Amount wasn't correctly sent to the receiver"
    );
  });*/
});
