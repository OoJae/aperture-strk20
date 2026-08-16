//! `GovernanceAnonymizer` — treasury payouts executed through the STRK20 pool.
//!
//! The pool withdraws value to this helper, calls `privacy_invoke`, and
//! deserializes the return value as `Span<OpenNoteDeposit>` so the value
//! re-enters the pool atomically. Modelled on the docs' stateful escrow
//! reference, which is explicitly unofficial and unaudited — Aperture owns the
//! review of anything derived from it.
//!
//! Invariants this contract must honour (verified against the STRK20 docs on
//! 2026-08-16, and enforced by the pool, not by us):
//!
//! * The pool is the only permitted caller of `privacy_invoke`.
//! * Return exactly a `Span<OpenNoteDeposit>`; trailing data makes the pool
//!   reject the call. An empty span is valid and means "credit nothing".
//! * Approve, don't transfer: the pool pulls the output when it applies the
//!   deposits.
//! * Measure outputs by balance delta rather than trusting calldata.
//! * At most one external invoke per pool transaction, so each step of the
//!   payout lifecycle is its own transaction.
//! * Open-note amounts are public on chain. A payout hides the recipient, not
//!   the amount — see docs/TRUST_MODEL.md.
//!
//! Phase 0 scope: interface and types only.

use starknet::ContractAddress;

/// Mirror of `privacy::objects::OpenNoteDeposit`.
///
/// The pool deserializes this positionally, so field order and types must match
/// the library struct exactly. Reordering these fields silently corrupts every
/// deposit this helper returns.
#[derive(Serde, Copy, Drop)]
pub struct OpenNoteDeposit {
    pub note_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
}

/// A treasury payout registered against a passed proposal, claimable by
/// whoever can produce the preimage of `commitment_hash`.
#[derive(Serde, Copy, Drop, starknet::Store)]
pub struct PayoutEntry {
    pub token: ContractAddress,
    pub amount: u128,
    pub proposal_id: u64,
    pub claimed: bool,
}

/// Selects the branch `privacy_invoke` dispatches to.
///
/// The protocol fixes only the return type of `privacy_invoke`, so a single
/// entry point can front several verbs.
#[derive(Serde, Copy, Drop, PartialEq)]
pub enum GovernanceOperation {
    /// Park value in the helper against a commitment. Returns an empty span:
    /// the pool has already moved the tokens here via its withdraw phase.
    RegisterPayout,
    /// Reveal the preimage and credit an open note back into the pool.
    Claim,
}

#[starknet::interface]
pub trait IGovernanceAnonymizer<TContractState> {
    /// Entry point invoked by the STRK20 pool.
    fn privacy_invoke(
        ref self: TContractState,
        operation: GovernanceOperation,
        commitment_hash: felt252,
        token: ContractAddress,
        amount: u128,
        secret: felt252,
        note_id: felt252,
    ) -> Span<OpenNoteDeposit>;

    /// Public read of a registered payout. Metadata only; the preimage that
    /// unlocks it never touches storage.
    fn get_payout(self: @TContractState, commitment_hash: felt252) -> PayoutEntry;

    /// Address of the STRK20 pool this helper accepts calls from.
    fn get_pool(self: @TContractState) -> ContractAddress;
}
