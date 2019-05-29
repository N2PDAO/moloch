pragma solidity 0.5.3;

import "./oz/SafeMath.sol";

contract Moloch {
    using SafeMath for uint256;

    struct Member {
        address delegateKey; // the key responsible for submitting proposals and voting - defaults to member address unless updated
        uint256 shares; // the # of shares assigned to this member
        uint256 delegatedShares; // the # of shares delegated to this member by other members of the DAO
        bool exists; // always true once a member has been created
        uint256 highestIndexYesVote; // highest proposal index # on which the member voted YES

        mapping (address => uint256) sharesDelegated; // the # of shares the member delegated to a certain adress
        mapping (address => uint256) arrayPointer;    // the Pointer at what position the adress of this member is stored in the array of the delegated
        address[] addressDelegatedTo;  // the adreses of member which delegated to this member
    }

    mapping (address => Member) public members;
    mapping (address => address) public memberAddressByDelegateKey;

    function add_member(address new_applicant)public{
      members[new_applicant] = Member(new_applicant, 20, 0, true, 0,new address[](0));
      memberAddressByDelegateKey[new_applicant] = new_applicant;
    }


    function delegateShares(address delegateTo) public {
        Member storage member = members[msg.sender];
        Member storage delegateMember = members[delegateTo];
        uint256 sharesToDelegate = member.shares.sub(1);
        require(delegateTo != address(0), "Moloch(N2P)::delegateShares - delegate cannot be 0");
        require(sharesToDelegate>0, "Moloch(N2P)::delegateShares - attempting to delegate more shares than you own");


        member.sharesDelegated[delegateTo] = member.sharesDelegated[delegateTo].add(sharesToDelegate);
        delegateMember.addressDelegatedTo.push(msg.sender);
        member.arrayPointer[delegateTo] = delegateMember.addressDelegatedTo.length;    ///.sub(1)
        delegateMember.delegatedShares = delegateMember.delegatedShares.add(sharesToDelegate);
        member.shares = member.shares.sub(sharesToDelegate);
        emit SharesDelegated(msg.sender, delegateTo, sharesToDelegate);
    }

    function retrieveShares(address retrieveFrom) public {
        Member storage member = members[msg.sender];
        Member storage memberRetrieve = members[retrieveFrom];
        uint256 sharesToRetrieve = member.sharesDelegated[retrieveFrom];
        require(retrieveFrom != address(0), "Moloch(N2P)::delegateShares - delegate cannot be 0");

        uint256 last_member_pointer = memberRetrieve.addressDelegatedTo.length.sub(1);
        uint256 length_array = memberRetrieve.addressDelegatedTo.length;
        uint256 array_pointer = member.arrayPointer[retrieveFrom];
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
        memberRetrieve.delegatedShares = memberRetrieve.delegatedShares.sub(sharesToRetrieve);
        member.sharesDelegated[retrieveFrom] = member.sharesDelegated[retrieveFrom].sub(sharesToRetrieve);
        member.shares = member.shares.add(sharesToRetrieve);
        emit SharesRetrieved(retrieveFrom, msg.sender, sharesToRetrieve);
    }

    function get_array ()public view returns(address[] memory){
        Member memory member = members[msg.sender];
        return  member.addressDelegatedTo;
    }

    function get_array_pointer(address member, address delegate)public view returns(uint){
      return members[member].arrayPointer[delegate];
    }


    function getSharesDelegated(address delegate) public view returns(uint256){
        Member storage member = members[msg.sender];
        return member.sharesDelegated[delegate];
    }
    
    function get_element_by_index(uint index) public view returns(address){
        uint256 lenghts =  members[msg.sender].addressDelegatedTo.length;
        return members[msg.sender].addressDelegatedTo[lenghts-1];
        
    }
    
    function get_array_lenght()public view returns(uint256){
        return members[msg.sender].addressDelegatedTo.length;
    }

    }
