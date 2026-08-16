//! `ProposalRegistry` — the public half of Aperture.
//!
//! Proposal metadata, voting windows, and finalized aggregate tallies are
//! public by design. The secrets are the ballots: who voted, for what, and with
//! how much. Those never reach this contract — only the aggregate does, posted
//! once by the tally service after the window closes.
//!
//! Phase 0 scope: interface and types only.

use starknet::ContractAddress;

#[derive(Serde, Copy, Drop, starknet::Store)]
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
#[derive(Serde, Copy, Drop, starknet::Store)]
pub struct Tally {
    pub for_weight: u128,
    pub against_weight: u128,
    pub abstain_weight: u128,
}

/// Ballot choices. Each maps to its own receiving identity per proposal, so a
/// vote is an ordinary private transfer into the chosen channel.
#[derive(Serde, Copy, Drop, PartialEq)]
pub enum Choice {
    For,
    Against,
    Abstain,
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

    /// Deterministic per-proposal, per-choice ballot channel id. Voters derive
    /// the same value client-side to address their private transfer.
    fn ballot_channel_id(self: @TContractState, proposal_id: u64, choice: Choice) -> felt252;

    fn is_allowed_proposer(self: @TContractState, account: ContractAddress) -> bool;

    fn proposal_count(self: @TContractState) -> u64;
}
