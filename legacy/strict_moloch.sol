pragma solidity 0.5.3;

import "./oz/SafeMath.sol";

contract Moloch {
    using SafeMath for uint256;

    enum Vote {
        Null, // default value, counted as abstention
        Yes,
        No
    }

    struct Member {
        address delegateKey; // the key responsible for submitting proposals and voting - defaults to member address unless updated
        uint256 shares; // the # of shares assigned to this member
        //uint256 delegatedShares; // the # of shares delegated to this member by other members of the DAO
        bool exists; // always true once a member has been created
        uint256 highestIndexYesVote; // highest proposal index # on which the member voted YES

        mapping (address => uint256) arrayPointer;    // the Pointer at what position the adress of this member is stored in the array of the delegated
        address[] addressDelegatedTo;  // the adreses of member which delegated to this member
        bool delegated;
    }

    struct Proposal {
        address proposer; // the member who submitted the proposal
        address applicant; // the applicant who wishes to become a member - this key will be used for withdrawals
        uint256 sharesRequested; // the # of shares the applicant is requesting
        uint256 startingPeriod; // the period in which voting can start for this proposal
        uint256 yesVotes; // the total number of YES votes for this proposal
        uint256 noVotes; // the total number of NO votes for this proposal
        bool processed; // true only if the proposal has been processed
        bool didPass; // true only if the proposal passed
        bool aborted; // true only if applicant calls "abort" fn before end of voting period
        uint256 tokenTribute; // amount of tokens offered as tribute
        string details; // proposal details - could be IPFS hash, plaintext, or JSON
        uint256 maxTotalSharesAtYesVote; // the maximum # of total shares encountered at a yes vote on this proposal
        mapping (address => Vote) votesByMember; // the votes on this proposal by each member

    }

    mapping (address => Member) public members;
    mapping (address => address) public memberAddressByDelegateKey;

    Proposal[] public proposalQueue;



    ///// ALL OF THESE FUNCTIONS ARE TEST FUNCTIONS

    function add_member(address new_applicant)public{
      members[new_applicant] = Member(new_applicant, 20, true, 0,new address[](0),false);
      memberAddressByDelegateKey[new_applicant] = new_applicant;
    }

    function add_proposal()public{
        Proposal memory proposal = Proposal({
            proposer: msg.sender,
            applicant: msg.sender,
            sharesRequested: 10,
            startingPeriod: 0,
            yesVotes: 0,
            noVotes: 0,
            processed: false,
            didPass: false,
            aborted: false,
            tokenTribute: 10,
            details: "details",
            maxTotalSharesAtYesVote: 0
        });

        proposalQueue.push(proposal);
    }

    function submitVote(uint256 proposalIndex, uint8 uintVote) public {
        address memberAddress = memberAddressByDelegateKey[msg.sender];
        Member storage member = members[memberAddress];

        require(proposalIndex < proposalQueue.length, "Moloch::submitVote - proposal does not exist");
        Proposal storage proposal = proposalQueue[proposalIndex];

        require(uintVote < 3, "Moloch::submitVote - uintVote must be less than 3");
        Vote vote = Vote(uintVote);

       // require(getCurrentPeriod() >= proposal.startingPeriod, "Moloch::submitVote - voting period has not started");
      //  require(!hasVotingPeriodExpired(proposal.startingPeriod), "Moloch::submitVote - proposal voting period has expired");
        require(proposal.votesByMember[memberAddress] == Vote.Null, "Moloch::submitVote - member has already voted on this proposal");
        require(vote == Vote.Yes || vote == Vote.No, "Moloch::submitVote - vote must be either Yes or No");
        require(!proposal.aborted, "Moloch::submitVote - proposal has been aborted");

        require(member.delegated == false , "Moloch::member has shares delegated");

        // store vote
        proposal.votesByMember[memberAddress] = vote;

        uint256 delegatedShares;

        for (uint i=0; i< member.addressDelegatedTo.length; i++) {
            address voted = member.addressDelegatedTo[i];

            if (proposal.votesByMember[voted] == Vote.Null){

                uint256 memberdelegatedShares = members[voted].shares;
                proposal.votesByMember[voted] = vote;
                delegatedShares = delegatedShares.add(memberdelegatedShares);
            }
        }



        // count vote
        if (vote == Vote.Yes) {
            proposal.yesVotes = proposal.yesVotes.add(member.shares + delegatedShares);

            // set highest index (latest) yes vote - must be processed for member to ragequit
            if (proposalIndex > member.highestIndexYesVote) {
                member.highestIndexYesVote = proposalIndex;
            }

            // set maximum of total shares encountered at a yes vote - used to bound dilution for yes voters
            //if (totalShares > proposal.maxTotalSharesAtYesVote) {
            //    proposal.maxTotalSharesAtYesVote = totalShares;
            //}

        } else if (vote == Vote.No) {
            proposal.noVotes = proposal.noVotes.add(member.shares + delegatedShares);
        }

        //emit SubmitVote(proposalIndex, msg.sender, memberAddress, uintVote);
    }

    /////////////////////////DELEGATION


    function delegateShares(address delegateTo) public {
        Member storage member = members[msg.sender];
        Member storage delegateMember = members[delegateTo];
        require(delegateTo != address(0), "Moloch(N2P)::delegateShares - delegate cannot be 0");
        require(member.delegated == false, "Moloch(N2P)::delegateShares - attempting to delegate shares while other shares are delegated");


        delegateMember.addressDelegatedTo.push(msg.sender);
        member.arrayPointer[delegateTo] = delegateMember.addressDelegatedTo.length;    ///.sub(1)
        member.delegated = true;

       // emit SharesDelegated(msg.sender, delegateTo, sharesToDelegate);
    }

    function retrieveShares(address retrieveFrom) public {
        Member storage member = members[msg.sender];
        Member storage memberRetrieve = members[retrieveFrom];
        uint256 array_pointer = member.arrayPointer[retrieveFrom];

        require(retrieveFrom != address(0), "Moloch(N2P)::delegateShares - delegate cannot be 0");
        require(member.delegated == true, "Moloch(N2P)::delegateShares - invalid trial attempting to retrive shares");
        require(memberRetrieve.addressDelegatedTo[array_pointer.sub(1)] == msg.sender, "Moloch(N2P)::delegateShares - invalid trial attempting to retrive not owned shares" );

        uint256 last_member_pointer = memberRetrieve.addressDelegatedTo.length.sub(1);
        uint256 length_array = memberRetrieve.addressDelegatedTo.length;
        address adress_index_change = memberRetrieve.addressDelegatedTo[last_member_pointer];

        //cleaning the array
        if (array_pointer <  length_array ) {     //// if the Pointer stored in the member, which delegates is smaller than the length of the array stored in the delegate do

          memberRetrieve.addressDelegatedTo[array_pointer.sub(1)] = memberRetrieve.addressDelegatedTo[last_member_pointer];   ///need to change index

          Member storage member_index_change = members[adress_index_change];               /// creating a mem struct in memory of the member which needs to change index
          member_index_change.arrayPointer[retrieveFrom] = array_pointer;                   ///need .add(1)
        }
        // we can now reduce the array length by 1
        //members[retrieveFrom].addressDelegatedTo--;
        members[retrieveFrom].addressDelegatedTo.length = members[retrieveFrom].addressDelegatedTo.length.sub(1);


        //require(sharesToRetrieve<=member.sharesDelegated[retrieveFrom], "Moloch(N2P)::delegateShares - attempting to retrieve more shares that you delegated");
        member.delegated = false;
       // emit SharesRetrieved(retrieveFrom, msg.sender, sharesToRetrieve);
    }

    function get_array ()public view returns(address[] memory){
        Member memory member = members[msg.sender];
        return  member.addressDelegatedTo;
    }

    function get_array_pointer(address member, address delegate)public view returns(uint){
      return members[member].arrayPointer[delegate];
    }


    function getSharesDelegated(address delegate) public view returns(uint256){
        Member storage member = members[delegate];
        uint256 delegatedShares;

        for (uint i=0; i< member.addressDelegatedTo.length; i++) {
            address delegator = member.addressDelegatedTo[i];
            uint256 memberdelegatedShares = members[delegator].shares;
            delegatedShares = delegatedShares.add(memberdelegatedShares);
        }

        return delegatedShares;
    }

    function get_element_by_index(uint index) public view returns(address){
        uint256 lenghts =  members[msg.sender].addressDelegatedTo.length;
        return members[msg.sender].addressDelegatedTo[lenghts-1];
    }

    function get_array_lenght()public view returns(uint256){
        return members[msg.sender].addressDelegatedTo.length;
    }

    function getMemberProposalVote(address memberAddress, uint256 proposalIndex) public view returns (Vote) {
        require(members[memberAddress].exists, "Moloch::getMemberProposalVote - member doesn't exist");
        require(proposalIndex < proposalQueue.length, "Moloch::getMemberProposalVote - proposal doesn't exist");
        return proposalQueue[proposalIndex].votesByMember[memberAddress];
    }

    }
