//! `ProposalRegistry` — the public half of Aperture.
//!
//! Proposal metadata, voting windows, and finalized aggregate tallies are
//! public by design. The secrets are the ballots: who voted, for what, and with
//! how much. Those never reach this contract — only the aggregate does, posted
//! once by the tally operator after the window closes.
//!
//! The registry also publishes where to vote. `ballot_address` derives the
//! receiving identity for a choice from public inputs, so a voter can check the
//! destination the front end offered them instead of trusting it.

use starknet::ContractAddress;
use crate::ballot::Choice;

#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct Proposal {
    pub proposer: ContractAddress,
    /// Pointer to off-chain proposal text (IPFS or HTTPS).
    pub metadata_uri: felt252,
    pub start_block: u64,
    pub end_block: u64,
    pub finalized: bool,
}

/// The only vote data that ever becomes public, and only after the window
/// closes.
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store, Default)]
pub struct Tally {
    pub for_weight: u128,
    pub against_weight: u128,
    pub abstain_weight: u128,
}

#[starknet::interface]
pub trait IProposalRegistry<TContractState> {
    fn create_proposal(
        ref self: TContractState, metadata_uri: felt252, start_block: u64, end_block: u64,
    ) -> u64;

    /// Post the aggregate result. Callable once, after `end_block`, by the
    /// tally operator.
    fn finalize(ref self: TContractState, proposal_id: u64, tally: Tally);

    fn get_proposal(self: @TContractState, proposal_id: u64) -> Proposal;
    fn get_tally(self: @TContractState, proposal_id: u64) -> Tally;

    /// True once finalized with strictly more weight for than against. This is
    /// what gates a treasury payout.
    fn has_passed(self: @TContractState, proposal_id: u64) -> bool;

    /// Where to send a ballot for this proposal and choice.
    fn ballot_address(self: @TContractState, proposal_id: u64, choice: Choice) -> ContractAddress;

    fn is_allowed_proposer(self: @TContractState, account: ContractAddress) -> bool;
    fn set_allowed_proposer(ref self: TContractState, account: ContractAddress, allowed: bool);
    fn proposal_count(self: @TContractState) -> u64;
    fn get_tally_operator(self: @TContractState) -> ContractAddress;
}

pub mod errors {
    pub const NOT_OWNER: felt252 = 'NOT_OWNER';
    pub const NOT_TALLY_OPERATOR: felt252 = 'NOT_TALLY_OPERATOR';
    pub const NOT_ALLOWED_PROPOSER: felt252 = 'NOT_ALLOWED_PROPOSER';
    pub const BAD_WINDOW: felt252 = 'BAD_WINDOW';
    pub const PROPOSAL_NOT_FOUND: felt252 = 'PROPOSAL_NOT_FOUND';
    pub const ALREADY_FINALIZED: felt252 = 'ALREADY_FINALIZED';
    pub const VOTING_STILL_OPEN: felt252 = 'VOTING_STILL_OPEN';
    pub const ZERO_ADDRESS: felt252 = 'ZERO_ADDRESS';
    pub const ZERO_CLASS_HASH: felt252 = 'ZERO_CLASS_HASH';
}

#[starknet::contract]
pub mod ProposalRegistry {
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_block_number, get_caller_address};
    use crate::ballot::{Choice, ballot_address as derive_ballot_address};
    use super::{IProposalRegistry, Proposal, Tally, errors};

    #[storage]
    struct Storage {
        owner: ContractAddress,
        tally_operator: ContractAddress,
        /// Account class the DAO's ballot identities are deployed from.
        ballot_account_class_hash: felt252,
        /// Public half of the DAO master key. The DAO derives the matching
        /// private keys off-chain, which is how the tally service can read the
        /// notes sent to these identities.
        dao_master_public_key: felt252,
        proposal_count: u64,
        proposals: Map<u64, Proposal>,
        tallies: Map<u64, Tally>,
        allowed_proposers: Map<ContractAddress, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        ProposalCreated: ProposalCreated,
        ProposalFinalized: ProposalFinalized,
        ProposerAllowed: ProposerAllowed,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ProposalCreated {
        #[key]
        pub proposal_id: u64,
        #[key]
        pub proposer: ContractAddress,
        pub metadata_uri: felt252,
        pub start_block: u64,
        pub end_block: u64,
    }

    /// Carries the aggregate only. Individual ballots are never emitted.
    #[derive(Drop, starknet::Event)]
    pub struct ProposalFinalized {
        #[key]
        pub proposal_id: u64,
        pub for_weight: u128,
        pub against_weight: u128,
        pub abstain_weight: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ProposerAllowed {
        #[key]
        pub account: ContractAddress,
        pub allowed: bool,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        tally_operator: ContractAddress,
        ballot_account_class_hash: felt252,
        dao_master_public_key: felt252,
    ) {
        assert(owner.is_non_zero(), errors::ZERO_ADDRESS);
        assert(tally_operator.is_non_zero(), errors::ZERO_ADDRESS);
        assert(ballot_account_class_hash.is_non_zero(), errors::ZERO_CLASS_HASH);
        assert(dao_master_public_key.is_non_zero(), errors::ZERO_CLASS_HASH);

        self.owner.write(owner);
        self.tally_operator.write(tally_operator);
        self.ballot_account_class_hash.write(ballot_account_class_hash);
        self.dao_master_public_key.write(dao_master_public_key);
        // The deployer can propose out of the box; otherwise a fresh registry
        // has no way to create its first proposal.
        self.allowed_proposers.write(owner, true);
    }

    #[abi(embed_v0)]
    pub impl ProposalRegistryImpl of IProposalRegistry<ContractState> {
        fn create_proposal(
            ref self: ContractState, metadata_uri: felt252, start_block: u64, end_block: u64,
        ) -> u64 {
            let caller = get_caller_address();
            assert(self.allowed_proposers.read(caller), errors::NOT_ALLOWED_PROPOSER);
            assert(end_block > start_block, errors::BAD_WINDOW);

            let proposal_id = self.proposal_count.read() + 1;
            self.proposal_count.write(proposal_id);
            self
                .proposals
                .write(
                    proposal_id,
                    Proposal {
                        proposer: caller, metadata_uri, start_block, end_block, finalized: false,
                    },
                );

            self
                .emit(
                    Event::ProposalCreated(
                        ProposalCreated {
                            proposal_id, proposer: caller, metadata_uri, start_block, end_block,
                        },
                    ),
                );
            proposal_id
        }

        fn finalize(ref self: ContractState, proposal_id: u64, tally: Tally) {
            assert(get_caller_address() == self.tally_operator.read(), errors::NOT_TALLY_OPERATOR);

            let proposal = self.proposals.read(proposal_id);
            assert(proposal.proposer.is_non_zero(), errors::PROPOSAL_NOT_FOUND);
            assert(!proposal.finalized, errors::ALREADY_FINALIZED);
            assert(get_block_number() > proposal.end_block, errors::VOTING_STILL_OPEN);

            self.proposals.write(proposal_id, Proposal { finalized: true, ..proposal });
            self.tallies.write(proposal_id, tally);

            self
                .emit(
                    Event::ProposalFinalized(
                        ProposalFinalized {
                            proposal_id,
                            for_weight: tally.for_weight,
                            against_weight: tally.against_weight,
                            abstain_weight: tally.abstain_weight,
                        },
                    ),
                );
        }

        fn get_proposal(self: @ContractState, proposal_id: u64) -> Proposal {
            self.proposals.read(proposal_id)
        }

        fn get_tally(self: @ContractState, proposal_id: u64) -> Tally {
            self.tallies.read(proposal_id)
        }

        fn has_passed(self: @ContractState, proposal_id: u64) -> bool {
            let proposal = self.proposals.read(proposal_id);
            if !proposal.finalized {
                return false;
            }
            let tally = self.tallies.read(proposal_id);
            tally.for_weight > tally.against_weight
        }

        fn ballot_address(
            self: @ContractState, proposal_id: u64, choice: Choice,
        ) -> ContractAddress {
            derive_ballot_address(
                proposal_id,
                choice,
                self.ballot_account_class_hash.read(),
                self.dao_master_public_key.read(),
            )
        }

        fn is_allowed_proposer(self: @ContractState, account: ContractAddress) -> bool {
            self.allowed_proposers.read(account)
        }

        fn set_allowed_proposer(
            ref self: ContractState, account: ContractAddress, allowed: bool,
        ) {
            assert(get_caller_address() == self.owner.read(), errors::NOT_OWNER);
            self.allowed_proposers.write(account, allowed);
            self.emit(Event::ProposerAllowed(ProposerAllowed { account, allowed }));
        }

        fn proposal_count(self: @ContractState) -> u64 {
            self.proposal_count.read()
        }

        fn get_tally_operator(self: @ContractState) -> ContractAddress {
            self.tally_operator.read()
        }
    }
}
