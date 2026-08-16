//! `GovernanceAnonymizer` — treasury payouts executed through the STRK20 pool.
//!
//! The pool withdraws value to this helper, calls `privacy_invoke`, and
//! deserializes the return value as `Span<OpenNoteDeposit>` so the value
//! re-enters the pool atomically. Modelled on the docs' stateful escrow
//! reference, which is explicitly unofficial and unaudited — Aperture owns the
//! review of everything derived from it, and adds a proposal gate and
//! balance-delta accounting that the reference does not have.
//!
//! Rules the pool enforces on us, verified against its source:
//!
//! * It calls us by raw syscall, so what matters is the entry point being named
//!   `privacy_invoke` and being external. The interface below is for our own
//!   dispatchers and tests.
//! * The return must deserialize to exactly `Span<OpenNoteDeposit>` with
//!   nothing trailing. An empty span is valid and means "credit nothing".
//! * The invoked contract is the depositor, so the pool pulls with
//!   `transfer_from`. We approve; we never transfer.
//! * At most one external invoke per pool transaction, so each step of the
//!   payout lifecycle is its own transaction.
//! * Open-note amounts are public on chain. A payout hides the recipient, not
//!   the amount — see docs/TRUST_MODEL.md.

use starknet::ContractAddress;

/// Mirror of `privacy::objects::OpenNoteDeposit`.
///
/// The pool deserializes this positionally, so field order and types must match
/// the library struct exactly. Reordering these fields silently corrupts every
/// deposit this helper returns. Declared locally rather than imported because
/// the `privacy` package is not published to the Scarb registry, and depending
/// on it by git would pin us to an older toolchain than we build with.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct OpenNoteDeposit {
    pub note_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
}

/// A treasury payout registered against a passed proposal, claimable by
/// whoever can produce the preimage of its commitment hash.
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct PayoutEntry {
    pub token: ContractAddress,
    pub amount: u128,
    pub proposal_id: u64,
    pub claimed: bool,
}

/// Selects the branch `privacy_invoke` dispatches to.
///
/// The protocol fixes only the return type, so a single entry point can front
/// several verbs.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub enum GovernanceOperation {
    /// Park value in the helper against a commitment. Returns an empty span:
    /// the pool has already moved the tokens here in its withdraw phase.
    RegisterPayout,
    /// Reveal the preimage and credit an open note back into the pool.
    Claim,
}

/// Domain separator for payout commitments.
pub const PAYOUT_COMMITMENT_TAG: felt252 = 'APERTURE_PAYOUT:V1';

/// The commitment a recipient must later open. Taking only the secret keeps the
/// preimage the single thing that unlocks a payout.
pub fn compute_commitment_hash(secret: felt252) -> felt252 {
    core::poseidon::poseidon_hash_span([PAYOUT_COMMITMENT_TAG, secret].span())
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
        proposal_id: u64,
        secret: felt252,
        note_id: felt252,
    ) -> Span<OpenNoteDeposit>;

    /// Public read of a registered payout. Metadata only; the preimage that
    /// unlocks it never touches storage.
    fn get_payout(self: @TContractState, commitment_hash: felt252) -> PayoutEntry;

    /// Address of the STRK20 pool this helper accepts calls from.
    fn get_pool(self: @TContractState) -> ContractAddress;

    /// Registry consulted to confirm a proposal actually passed.
    fn get_registry(self: @TContractState) -> ContractAddress;
}

pub mod errors {
    pub const CALLER_NOT_POOL: felt252 = 'CALLER_NOT_POOL';
    pub const ZERO_COMMITMENT_HASH: felt252 = 'ZERO_COMMITMENT_HASH';
    pub const ZERO_TOKEN: felt252 = 'ZERO_TOKEN';
    pub const ZERO_AMOUNT: felt252 = 'ZERO_AMOUNT';
    pub const ZERO_ADDRESS: felt252 = 'ZERO_ADDRESS';
    pub const COMMITMENT_EXISTS: felt252 = 'COMMITMENT_EXISTS';
    pub const COMMITMENT_NOT_FOUND: felt252 = 'COMMITMENT_NOT_FOUND';
    pub const ALREADY_CLAIMED: felt252 = 'ALREADY_CLAIMED';
    pub const PROPOSAL_NOT_PASSED: felt252 = 'PROPOSAL_NOT_PASSED';
    pub const INSUFFICIENT_BALANCE: felt252 = 'INSUFFICIENT_BALANCE';
    pub const AMOUNT_OVERFLOW: felt252 = 'AMOUNT_OVERFLOW';
}

/// Minimal ERC20 surface. Declared locally so the contract keeps `starknet` as
/// its only dependency.
#[starknet::interface]
pub trait IErc20<TState> {
    fn balance_of(self: @TState, account: ContractAddress) -> u256;
    fn approve(ref self: TState, spender: ContractAddress, amount: u256) -> bool;
}

#[starknet::contract]
pub mod GovernanceAnonymizer {
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use crate::proposal_registry::{
        IProposalRegistryDispatcher, IProposalRegistryDispatcherTrait,
    };
    use super::{
        GovernanceOperation, IErc20Dispatcher, IErc20DispatcherTrait, IGovernanceAnonymizer,
        OpenNoteDeposit, PayoutEntry, compute_commitment_hash, errors,
    };

    #[storage]
    struct Storage {
        /// Immutable by design: the whole security story is that the pool is
        /// the only caller, so there is nothing to transfer or renounce.
        pool: ContractAddress,
        registry: ContractAddress,
        payouts: Map<felt252, PayoutEntry>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PayoutRegistered: PayoutRegistered,
        PayoutClaimed: PayoutClaimed,
    }

    /// Deliberately carries no recipient — nobody is identified until they
    /// claim, and even then only a note id appears.
    #[derive(Drop, starknet::Event)]
    pub struct PayoutRegistered {
        #[key]
        pub commitment_hash: felt252,
        #[key]
        pub proposal_id: u64,
        pub token: ContractAddress,
        pub amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PayoutClaimed {
        #[key]
        pub commitment_hash: felt252,
        pub token: ContractAddress,
        pub amount: u128,
        pub note_id: felt252,
    }

    #[constructor]
    fn constructor(ref self: ContractState, pool: ContractAddress, registry: ContractAddress) {
        assert(pool.is_non_zero(), errors::ZERO_ADDRESS);
        assert(registry.is_non_zero(), errors::ZERO_ADDRESS);
        self.pool.write(pool);
        self.registry.write(registry);
    }

    #[abi(embed_v0)]
    pub impl GovernanceAnonymizerImpl of IGovernanceAnonymizer<ContractState> {
        fn privacy_invoke(
            ref self: ContractState,
            operation: GovernanceOperation,
            commitment_hash: felt252,
            token: ContractAddress,
            amount: u128,
            proposal_id: u64,
            secret: felt252,
            note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            // Checked once, before the dispatch, so it covers both branches.
            let pool = self.pool.read();
            assert(get_caller_address() == pool, errors::CALLER_NOT_POOL);

            match operation {
                GovernanceOperation::RegisterPayout => {
                    self.register_payout(commitment_hash, token, amount, proposal_id, pool)
                },
                GovernanceOperation::Claim => { self.claim(secret, note_id, pool) },
            }
        }

        fn get_payout(self: @ContractState, commitment_hash: felt252) -> PayoutEntry {
            self.payouts.read(commitment_hash)
        }

        fn get_pool(self: @ContractState) -> ContractAddress {
            self.pool.read()
        }

        fn get_registry(self: @ContractState) -> ContractAddress {
            self.registry.read()
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn register_payout(
            ref self: ContractState,
            commitment_hash: felt252,
            token: ContractAddress,
            amount: u128,
            proposal_id: u64,
            pool: ContractAddress,
        ) -> Span<OpenNoteDeposit> {
            assert(commitment_hash.is_non_zero(), errors::ZERO_COMMITMENT_HASH);
            assert(token.is_non_zero(), errors::ZERO_TOKEN);
            assert(amount.is_non_zero(), errors::ZERO_AMOUNT);

            // A payout only exists because the DAO voted for it. This is the
            // gate the escrow reference has no equivalent of.
            let registry = IProposalRegistryDispatcher {
                contract_address: self.registry.read(),
            };
            assert(registry.has_passed(proposal_id), errors::PROPOSAL_NOT_PASSED);

            let existing = self.payouts.read(commitment_hash);
            assert(existing.token.is_zero(), errors::COMMITMENT_EXISTS);

            // The pool withdrew to us before invoking, so the funds should
            // already be here. Verified rather than assumed.
            let held = IErc20Dispatcher { contract_address: token }
                .balance_of(get_contract_address());
            assert(held >= amount.into(), errors::INSUFFICIENT_BALANCE);

            self
                .payouts
                .write(
                    commitment_hash,
                    PayoutEntry { token, amount, proposal_id, claimed: false },
                );

            self
                .emit(
                    Event::PayoutRegistered(
                        PayoutRegistered { commitment_hash, proposal_id, token, amount },
                    ),
                );

            // Tokens stay escrowed here until someone opens the commitment.
            // An empty span tells the pool to credit nothing.
            let _ = pool;
            [].span()
        }

        fn claim(
            ref self: ContractState, secret: felt252, note_id: felt252, pool: ContractAddress,
        ) -> Span<OpenNoteDeposit> {
            // Recomputed from the secret; any commitment hash passed in
            // calldata is ignored, so only the preimage can unlock a payout.
            let commitment_hash = compute_commitment_hash(secret);
            let entry = self.payouts.read(commitment_hash);
            assert(entry.token.is_non_zero(), errors::COMMITMENT_NOT_FOUND);
            assert(!entry.claimed, errors::ALREADY_CLAIMED);

            // Effects before interaction: the entry is spent before any
            // external call, so a reentrant claim finds it already taken.
            self.payouts.write(commitment_hash, PayoutEntry { claimed: true, ..entry });

            // Credit what we can actually back, not what calldata claimed.
            // The escrow reference trusts its stored amount; measuring instead
            // means a helper that is short for any reason fails here rather
            // than returning a deposit the pool cannot pull.
            let erc20 = IErc20Dispatcher { contract_address: entry.token };
            let held = erc20.balance_of(get_contract_address());
            let held_u128: u128 = held.try_into().expect(errors::AMOUNT_OVERFLOW);
            assert(held_u128 >= entry.amount, errors::INSUFFICIENT_BALANCE);

            // Approve, never transfer: the pool pulls with transfer_from when
            // it applies the deposit.
            erc20.approve(pool, entry.amount.into());

            self
                .emit(
                    Event::PayoutClaimed(
                        PayoutClaimed {
                            commitment_hash, token: entry.token, amount: entry.amount, note_id,
                        },
                    ),
                );

            [OpenNoteDeposit { note_id, token: entry.token, amount: entry.amount }].span()
        }
    }
}
