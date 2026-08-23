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
    // v2 fields are APPENDED, never inserted. Off-chain readers decode this
    // struct positionally, so appending leaves indices 0..4 meaning exactly what
    // they meant before; a half-migrated client reads a missing field rather
    // than reading `quorum` as `finalized`.
    /// Minimum turnout, at or above the registry's immutable floor.
    pub quorum: u128,
    /// The only token a payout against this proposal may move.
    pub payout_token: ContractAddress,
    /// Cumulative ceiling on payouts against this proposal. Zero is legal and
    /// means the proposal authorises no spend.
    pub payout_cap: u128,
}

/// Where a published tally came from.
///
/// `Unset` is first, and so is variant index 0, because that is what an
/// unwritten storage slot reads as. If the stronger claim sat at 0, every
/// proposal that was never finalized would silently read as `BallotDerived`.
/// Reordering these variants is a consensus change.
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub enum TallyProvenance {
    #[default]
    Unset,
    /// Summed from notes received by this proposal's ballot identities, at the
    /// state of `counted_through`.
    BallotDerived,
    /// Entered by the tally operator. No ballot produced it.
    OperatorAsserted,
}

/// Everything the anonymizer needs to decide whether, and how much, it may pay
/// — in one call, so the four cannot be read from four different states.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct PayoutTerms {
    pub passed: bool,
    pub token: ContractAddress,
    pub cap: u128,
    pub provenance: TallyProvenance,
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
        ref self: TContractState,
        metadata_uri: felt252,
        start_block: u64,
        end_block: u64,
        quorum: u128,
        payout_token: ContractAddress,
        payout_cap: u128,
    ) -> u64;

    /// Post the aggregate result. Callable once, after `end_block`, by the
    /// tally operator.
    ///
    /// `counted_through_block` must equal the proposal's `end_block`. See the
    /// implementation for why that is the only acceptable value, and for what
    /// the assert does and does not prove.
    fn finalize(
        ref self: TContractState,
        proposal_id: u64,
        tally: Tally,
        counted_through_block: u64,
        provenance: TallyProvenance,
    );

    fn get_proposal(self: @TContractState, proposal_id: u64) -> Proposal;
    fn get_tally(self: @TContractState, proposal_id: u64) -> Tally;

    /// True once finalized, with turnout at or above quorum and strictly more
    /// weight for than against. This is what gates a treasury payout.
    fn has_passed(self: @TContractState, proposal_id: u64) -> bool;

    /// The single definition of "passed", plus the terms a payout must obey.
    /// `has_passed` delegates to this so the registry and the anonymizer cannot
    /// drift apart.
    fn payout_terms(self: @TContractState, proposal_id: u64) -> PayoutTerms;

    /// The block the count was pinned to. Equal to `end_block` for every
    /// finalized proposal, and zero for every proposal that is not — with no
    /// ambiguity, because `create_proposal` guarantees `end_block >= 1`.
    fn get_counted_through(self: @TContractState, proposal_id: u64) -> u64;
    fn get_provenance(self: @TContractState, proposal_id: u64) -> TallyProvenance;

    /// The separator every ballot address and viewing key for this registry
    /// derives from.
    fn ballot_domain(self: @TContractState) -> felt252;
    fn get_chain_id(self: @TContractState) -> felt252;
    fn get_epoch(self: @TContractState) -> felt252;
    fn min_quorum(self: @TContractState) -> u128;

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
    /// v1 asserted the master public key with ZERO_CLASS_HASH. Its own constant.
    pub const ZERO_PUBLIC_KEY: felt252 = 'ZERO_PUBLIC_KEY';
    pub const ZERO_CHAIN_ID: felt252 = 'ZERO_CHAIN_ID';
    pub const ZERO_EPOCH: felt252 = 'ZERO_EPOCH';
    pub const ZERO_QUORUM: felt252 = 'ZERO_QUORUM';
    pub const ZERO_PAYOUT_TOKEN: felt252 = 'ZERO_PAYOUT_TOKEN';
    pub const QUORUM_BELOW_FLOOR: felt252 = 'QUORUM_BELOW_FLOOR';
    pub const WINDOW_IN_THE_PAST: felt252 = 'WINDOW_IN_THE_PAST';
    pub const COUNTED_THROUGH_MISMATCH: felt252 = 'COUNTED_THROUGH_MISMATCH';
    pub const PROVENANCE_UNSET: felt252 = 'PROVENANCE_UNSET';
}

#[starknet::contract]
pub mod ProposalRegistry {
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{
        ContractAddress, get_block_number, get_caller_address, get_contract_address,
    };
    use crate::ballot::{
        Choice, ballot_address as derive_ballot_address, ballot_domain as compute_ballot_domain,
    };
    use super::{IProposalRegistry, PayoutTerms, Proposal, Tally, TallyProvenance, errors};

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
        /// Both are inputs to `ballot_domain`, written once and never again.
        chain_id: felt252,
        epoch: felt252,
        /// Turnout floor no proposal may go below. A per-proposal quorum may
        /// raise it, never lower it.
        min_quorum: u128,
        proposal_count: u64,
        proposals: Map<u64, Proposal>,
        tallies: Map<u64, Tally>,
        /// Parallel to `tallies`, deliberately. `Tally` derives `Default` and the
        /// suite builds it positionally, so anything that must be *stated*
        /// cannot sit behind a default that would supply zero silently.
        counted_through: Map<u64, u64>,
        provenances: Map<u64, TallyProvenance>,
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
        pub quorum: u128,
        pub payout_token: ContractAddress,
        pub payout_cap: u128,
    }

    /// Carries the aggregate only. Individual ballots are never emitted.
    #[derive(Drop, starknet::Event)]
    pub struct ProposalFinalized {
        #[key]
        pub proposal_id: u64,
        pub for_weight: u128,
        pub against_weight: u128,
        pub abstain_weight: u128,
        /// The block the count was pinned to. Always equal to `end_block`.
        pub counted_through_block: u64,
        pub provenance: TallyProvenance,
        /// Emitted so the pass rule can be checked from the log alone.
        pub quorum: u128,
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
        chain_id: felt252,
        epoch: felt252,
        min_quorum: u128,
    ) {
        assert(owner.is_non_zero(), errors::ZERO_ADDRESS);
        assert(tally_operator.is_non_zero(), errors::ZERO_ADDRESS);
        assert(ballot_account_class_hash.is_non_zero(), errors::ZERO_CLASS_HASH);
        assert(dao_master_public_key.is_non_zero(), errors::ZERO_PUBLIC_KEY);
        assert(chain_id.is_non_zero(), errors::ZERO_CHAIN_ID);
        assert(epoch.is_non_zero(), errors::ZERO_EPOCH);
        // A zero floor is the one value that leaves the quorum machinery looking
        // configured while doing nothing at all.
        assert(min_quorum.is_non_zero(), errors::ZERO_QUORUM);

        self.owner.write(owner);
        self.tally_operator.write(tally_operator);
        self.ballot_account_class_hash.write(ballot_account_class_hash);
        self.dao_master_public_key.write(dao_master_public_key);
        self.chain_id.write(chain_id);
        self.epoch.write(epoch);
        self.min_quorum.write(min_quorum);
        // The deployer can propose out of the box; otherwise a fresh registry
        // has no way to create its first proposal.
        self.allowed_proposers.write(owner, true);
    }

    #[abi(embed_v0)]
    pub impl ProposalRegistryImpl of IProposalRegistry<ContractState> {
        fn create_proposal(
            ref self: ContractState,
            metadata_uri: felt252,
            start_block: u64,
            end_block: u64,
            quorum: u128,
            payout_token: ContractAddress,
            payout_cap: u128,
        ) -> u64 {
            let caller = get_caller_address();
            assert(self.allowed_proposers.read(caller), errors::NOT_ALLOWED_PROPOSER);
            assert(end_block > start_block, errors::BAD_WINDOW);
            // v1 compared the window to nothing, so a proposal whose window had
            // already closed could be created and finalized in the same block —
            // which makes `counted_through` a pin to a block predating the
            // proposal. The repo's own deploy script does exactly that today,
            // with `--calldata 0x1 0x0 0x1`.
            assert(start_block >= get_block_number(), errors::WINDOW_IN_THE_PAST);
            // A proposal may demand more turnout than the floor, never less.
            assert(quorum >= self.min_quorum.read(), errors::QUORUM_BELOW_FLOOR);
            // A zero cap is legal — most proposals spend nothing — but a zero
            // token is not, because it would make `payout_terms.token`
            // unmatchable and the gate meaningless.
            assert(payout_token.is_non_zero(), errors::ZERO_PAYOUT_TOKEN);

            let proposal_id = self.proposal_count.read() + 1;
            self.proposal_count.write(proposal_id);
            self
                .proposals
                .write(
                    proposal_id,
                    Proposal {
                        proposer: caller,
                        metadata_uri,
                        start_block,
                        end_block,
                        finalized: false,
                        quorum,
                        payout_token,
                        payout_cap,
                    },
                );

            self
                .emit(
                    Event::ProposalCreated(
                        ProposalCreated {
                            proposal_id,
                            proposer: caller,
                            metadata_uri,
                            start_block,
                            end_block,
                            quorum,
                            payout_token,
                            payout_cap,
                        },
                    ),
                );
            proposal_id
        }

        fn finalize(
            ref self: ContractState,
            proposal_id: u64,
            tally: Tally,
            counted_through_block: u64,
            provenance: TallyProvenance,
        ) {
            assert(get_caller_address() == self.tally_operator.read(), errors::NOT_TALLY_OPERATOR);

            let proposal = self.proposals.read(proposal_id);
            assert(proposal.proposer.is_non_zero(), errors::PROPOSAL_NOT_FOUND);
            assert(!proposal.finalized, errors::ALREADY_FINALIZED);
            assert(get_block_number() > proposal.end_block, errors::VOTING_STILL_OPEN);

            // The pin, bound on chain.
            //
            // Exactly `end_block`, nothing else. It is the only height at which
            // every in-window ballot exists and no out-of-window ballot does: a
            // note that arrives later is not filtered out at this height, it is
            // invisible. That is the difference between this assert and a window
            // filter written off chain — which is what was missing when a ballot
            // 945 blocks past the close was counted into a published result.
            //
            // What this does NOT do is prove the count was taken here. It
            // rejects a caller that never computed the pin: a client counting at
            // `head - 10` cannot produce this value, and the zero a forgetful
            // caller sends is rejected too. Nobody should write "the contract
            // verifies the count".
            assert(
                counted_through_block == proposal.end_block, errors::COUNTED_THROUGH_MISMATCH,
            );

            // Stated, never defaulted. Accepting `Unset` would make "nobody
            // said" indistinguishable from "somebody said the weaker thing".
            assert(provenance != TallyProvenance::Unset, errors::PROVENANCE_UNSET);

            self.proposals.write(proposal_id, Proposal { finalized: true, ..proposal });
            self.tallies.write(proposal_id, tally);
            self.counted_through.write(proposal_id, counted_through_block);
            self.provenances.write(proposal_id, provenance);

            self
                .emit(
                    Event::ProposalFinalized(
                        ProposalFinalized {
                            proposal_id,
                            for_weight: tally.for_weight,
                            against_weight: tally.against_weight,
                            abstain_weight: tally.abstain_weight,
                            counted_through_block,
                            provenance,
                            quorum: proposal.quorum,
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
            self.payout_terms(proposal_id).passed
        }

        fn payout_terms(self: @ContractState, proposal_id: u64) -> PayoutTerms {
            let proposal = self.proposals.read(proposal_id);
            let tally = self.tallies.read(proposal_id);

            // u256, so three maximal u128 weights cannot wrap. v1 summed nothing
            // here, but the quorum check does — and this view is called by the
            // anonymizer inside a pool transaction, where an arithmetic panic
            // reverts the whole thing with an error naming nothing.
            let turnout: u256 = tally.for_weight.into()
                + tally.against_weight.into()
                + tally.abstain_weight.into();

            // Provenance is deliberately not part of this test. A ballot-derived
            // and an operator-asserted tally pass on identical arithmetic; the
            // difference is bounded by the anonymizer's immutable asserted cap,
            // not by pretending an asserted result is not a result. Gating here
            // instead would make the anonymizer undemonstrable on a network with
            // no indexer, and would reward mislabelling.
            let passed = proposal.finalized
                && turnout >= proposal.quorum.into()
                && tally.for_weight > tally.against_weight;

            PayoutTerms {
                passed,
                token: proposal.payout_token,
                cap: proposal.payout_cap,
                provenance: self.provenances.read(proposal_id),
            }
        }

        fn get_counted_through(self: @ContractState, proposal_id: u64) -> u64 {
            self.counted_through.read(proposal_id)
        }

        fn get_provenance(self: @ContractState, proposal_id: u64) -> TallyProvenance {
            self.provenances.read(proposal_id)
        }

        fn ballot_domain(self: @ContractState) -> felt252 {
            // The registry supplies its own address, so the one input that must
            // be unique per deployment cannot be got wrong in deploy calldata.
            compute_ballot_domain(
                self.chain_id.read(), get_contract_address(), self.epoch.read(),
            )
        }

        fn get_chain_id(self: @ContractState) -> felt252 {
            self.chain_id.read()
        }

        fn get_epoch(self: @ContractState) -> felt252 {
            self.epoch.read()
        }

        fn min_quorum(self: @ContractState) -> u128 {
            self.min_quorum.read()
        }

        fn ballot_address(
            self: @ContractState, proposal_id: u64, choice: Choice,
        ) -> ContractAddress {
            derive_ballot_address(
                self.ballot_domain(),
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
