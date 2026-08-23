//! `GovernanceAnonymizer` — treasury payouts executed through the STRK20 pool.
//!
//! The pool withdraws value to this helper, calls `privacy_invoke`, and
//! deserializes the return value as `Span<OpenNoteDeposit>` so the value
//! re-enters the pool atomically. Modelled on the docs' stateful escrow
//! reference, which is explicitly unofficial and unaudited — Aperture owns the
//! review of everything derived from it, and adds a proposal gate, payout terms
//! bound to the proposal that authorised them, and an aggregate escrow ledger
//! that the reference does not have.
//!
//! # The escrow ledger
//!
//! `outstanding[token]` is the sum of every registered, unclaimed payout in that
//! token. Both writes to it assert the same inequality against the pre-pull
//! total:
//!
//!     balance_of(self) >= outstanding[token]
//!
//! so a payout can only be registered against value nothing else already
//! claims, and a claim is only approved if every other unclaimed payout stays
//! backed after the pool pulls this one.
//!
//! v1 compared each payout against the absolute balance with no aggregate at
//! all, so N payouts could be registered against one balance and the last N-1
//! claims would find nothing left. An earlier version of this header claimed
//! "balance-delta accounting that the reference does not have"; no such
//! accounting existed and the sentence was aspirational. It describes this
//! contract for the first time.
//!
//! # Immutable, and what that costs
//!
//! No owner, no pause, no upgrade path, no sweep. The only authorisation
//! anywhere in this contract is `caller == pool`, and the ERC20 interface below
//! has no `transfer` — so there is no code path by which this contract can send
//! a token anywhere. Value leaves only as an allowance granted to the pool when
//! a registered commitment is claimed.
//!
//! One consequence is deliberate and permanent: **tokens sent here without a
//! payout registered against them in the same pool transaction can never be
//! recovered, by anyone, including the DAO.** `get_unattached` reports them so
//! they can be seen; nothing can move them. 14 STRK sits like that in the v1
//! contract on mainnet. See docs/TRUST_MODEL.md.
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
pub const PAYOUT_COMMITMENT_TAG: felt252 = 'APERTURE_PAYOUT:V2';

/// The commitment a recipient must later open. Taking only the secret keeps the
/// preimage the single thing that unlocks a payout.
/// The commitment a recipient must later open.
///
/// v1 hashed the secret alone, so one preimage opened whichever entry happened
/// to match — any amount, any token, any proposal, on any chain. Binding the
/// terms means the preimage is a tuple and every field of the payout is fixed at
/// registration: a holder of the secret cannot open for more than was escrowed,
/// and a secret from one deployment is worthless on another.
pub fn compute_commitment_hash(
    domain: felt252,
    proposal_id: u64,
    token: ContractAddress,
    amount: u128,
    secret: felt252,
) -> felt252 {
    core::poseidon::poseidon_hash_span(
        [
            PAYOUT_COMMITMENT_TAG, domain, proposal_id.into(), token.into(), amount.into(),
            secret,
        ]
            .span(),
    )
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
    /// Value held in this token that no commitment is backed by.
    ///
    /// Diagnostic only. Nothing in this contract can move it, by design — the
    /// ERC20 interface below has no `transfer`. A non-zero result means someone
    /// funded this contract without registering a payout in the same pool
    /// transaction, and that value is now permanently stranded. Publish it; do
    /// not plan around recovering it. 14 STRK sits like this in v1 on mainnet.
    fn get_unattached(self: @TContractState, token: ContractAddress) -> u256;

    /// Registered-but-unclaimed value, per token. The invariant this contract
    /// exists to keep is `balance_of(self) >= get_outstanding(token)`.
    fn get_outstanding(self: @TContractState, token: ContractAddress) -> u256;

    /// Cumulative value committed against a proposal.
    fn get_spent(self: @TContractState, proposal_id: u64) -> u128;

    fn get_payout_domain(self: @TContractState) -> felt252;
    fn get_asserted_payout_cap(self: @TContractState) -> u128;

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
    /// Registration: the pool did not withdraw enough to back this payout on
    /// top of everything already escrowed. v1 used one constant for this and
    /// the claim-time failure, so a reverted pool transaction told you only
    /// "something about a balance".
    pub const HELPER_UNDERFUNDED: felt252 = 'HELPER_UNDERFUNDED';
    /// Claim: the helper holds less than it owes, so paying this claim would
    /// leave another one permanently unbacked. Fails loudly instead.
    pub const UNBACKED_PAYOUT: felt252 = 'UNBACKED_PAYOUT';
    /// Claim: the ledger owes less than this entry. Unreachable if the ledger
    /// is consistent, and guarded because with no sweep a wrap is unrecoverable.
    pub const LEDGER_UNDERFLOW: felt252 = 'LEDGER_UNDERFLOW';
    pub const ZERO_DOMAIN: felt252 = 'ZERO_DOMAIN';
    pub const WRONG_PAYOUT_TOKEN: felt252 = 'WRONG_PAYOUT_TOKEN';
    /// The stored entry disagrees with the preimage the claimant proved. Only
    /// reachable via a registration whose commitment did not describe its own
    /// terms, which is an attack rather than an accident.
    pub const TERMS_MISMATCH: felt252 = 'TERMS_MISMATCH';
    pub const PAYOUT_CAP_EXCEEDED: felt252 = 'PAYOUT_CAP_EXCEEDED';
    pub const ASSERTED_CAP_EXCEEDED: felt252 = 'ASSERTED_CAP_EXCEEDED';
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
        IProposalRegistryDispatcher, IProposalRegistryDispatcherTrait, TallyProvenance,
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
        /// Cached at construction from the registry. Reading it there also
        /// proves, at deploy time, that `registry` really is a
        /// ProposalRegistry — the one check that would have caught v1's Sepolia
        /// anonymizer being wired to the superseded registry, a mistake that is
        /// write-once and so was final.
        payout_domain: felt252,
        /// Cumulative ceiling on payouts against a proposal whose tally the
        /// operator asserted rather than counted. Zero means an asserted tally
        /// funds nothing.
        asserted_payout_cap: u128,
        payouts: Map<felt252, PayoutEntry>,
        /// Registered-and-unclaimed value, per token. The escrow ledger, and
        /// the thing v1 did not have: it compared each payout against the
        /// absolute balance, so N payouts could be registered against one
        /// balance and the last N-1 claims would find nothing left.
        outstanding: Map<ContractAddress, u256>,
        /// Value committed against a proposal. Incremented at registration
        /// rather than at claim: with no sweep, escrowed-but-unclaimed value is
        /// spent in every sense that matters.
        spent: Map<u64, u128>,
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
        /// The escrow ledger after this registration, so an indexer can follow
        /// the invariant without replaying every event.
        pub outstanding_after: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PayoutClaimed {
        #[key]
        pub commitment_hash: felt252,
        pub token: ContractAddress,
        pub amount: u128,
        pub note_id: felt252,
        pub outstanding_after: u256,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        pool: ContractAddress,
        registry: ContractAddress,
        asserted_payout_cap: u128,
    ) {
        assert(pool.is_non_zero(), errors::ZERO_ADDRESS);
        assert(registry.is_non_zero(), errors::ZERO_ADDRESS);
        self.pool.write(pool);
        self.registry.write(registry);
        // Zero is a legal cap, and is Sepolia's configuration.
        self.asserted_payout_cap.write(asserted_payout_cap);

        // Fail the deploy rather than the first payout if `registry` is not a
        // registry.
        let domain = IProposalRegistryDispatcher { contract_address: registry }.ballot_domain();
        assert(domain.is_non_zero(), errors::ZERO_DOMAIN);
        self.payout_domain.write(domain);
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
                GovernanceOperation::Claim => {
                    self.claim(token, amount, proposal_id, secret, note_id, pool)
                },
            }
        }

        fn get_payout(self: @ContractState, commitment_hash: felt252) -> PayoutEntry {
            self.payouts.read(commitment_hash)
        }

        fn get_unattached(self: @ContractState, token: ContractAddress) -> u256 {
            let held = IErc20Dispatcher { contract_address: token }
                .balance_of(get_contract_address());
            let outstanding = self.outstanding.read(token);
            // Saturating rather than checked: a diagnostic that panics when the
            // news is bad is a diagnostic nobody can use.
            if held > outstanding {
                held - outstanding
            } else {
                0
            }
        }

        fn get_outstanding(self: @ContractState, token: ContractAddress) -> u256 {
            self.outstanding.read(token)
        }

        fn get_spent(self: @ContractState, proposal_id: u64) -> u128 {
            self.spent.read(proposal_id)
        }

        fn get_payout_domain(self: @ContractState) -> felt252 {
            self.payout_domain.read()
        }

        fn get_asserted_payout_cap(self: @ContractState) -> u128 {
            self.asserted_payout_cap.read()
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

            // One call for the gate, the token, the cap and the provenance, so
            // the four cannot be read from four different states. v1 asked only
            // `has_passed`, which is a permanent boolean carrying no amount and
            // no token — an unlimited, reusable licence over any token the
            // caller named.
            let registry = IProposalRegistryDispatcher {
                contract_address: self.registry.read(),
            };
            let terms = registry.payout_terms(proposal_id);
            assert(terms.passed, errors::PROPOSAL_NOT_PASSED);
            assert(token == terms.token, errors::WRONG_PAYOUT_TOKEN);

            let existing = self.payouts.read(commitment_hash);
            assert(existing.token.is_zero(), errors::COMMITMENT_EXISTS);

            // Caps in u256, so the sum cannot wrap before it is compared.
            let spent_after: u256 = self.spent.read(proposal_id).into() + amount.into();
            assert(spent_after <= terms.cap.into(), errors::PAYOUT_CAP_EXCEEDED);
            if terms.provenance == TallyProvenance::OperatorAsserted {
                assert(
                    spent_after <= self.asserted_payout_cap.read().into(),
                    errors::ASSERTED_CAP_EXCEEDED,
                );
            }

            // The escrow ledger.
            //
            // `held >= outstanding + amount`, not `held >= amount`. The weak
            // form lets a second registration succeed against a balance the
            // first already claims, and with no sweep an over-committed helper
            // can never be brought back into balance by anybody.
            let held = IErc20Dispatcher { contract_address: token }
                .balance_of(get_contract_address());
            let outstanding_after = self.outstanding.read(token) + amount.into();
            assert(held >= outstanding_after, errors::HELPER_UNDERFUNDED);

            self
                .payouts
                .write(
                    commitment_hash,
                    PayoutEntry { token, amount, proposal_id, claimed: false },
                );
            self.outstanding.write(token, outstanding_after);
            self
                .spent
                .write(proposal_id, spent_after.try_into().expect(errors::AMOUNT_OVERFLOW));

            self
                .emit(
                    Event::PayoutRegistered(
                        PayoutRegistered {
                            commitment_hash, proposal_id, token, amount, outstanding_after,
                        },
                    ),
                );

            // Tokens stay escrowed here until someone opens the commitment.
            // An empty span tells the pool to credit nothing.
            let _ = pool;
            [].span()
        }

        fn claim(
            ref self: ContractState,
            token: ContractAddress,
            amount: u128,
            proposal_id: u64,
            secret: felt252,
            note_id: felt252,
            pool: ContractAddress,
        ) -> Span<OpenNoteDeposit> {
            // Recomputed from the preimage; any commitment hash in calldata is
            // still ignored. The preimage is a tuple now, so a secret cannot
            // open a payout for a different amount, token, proposal or chain.
            let commitment_hash = compute_commitment_hash(
                self.payout_domain.read(), proposal_id, token, amount, secret,
            );
            let entry = self.payouts.read(commitment_hash);
            assert(entry.token.is_non_zero(), errors::COMMITMENT_NOT_FOUND);
            assert(!entry.claimed, errors::ALREADY_CLAIMED);

            // The stored terms must be the terms just proved.
            //
            // `register_payout` takes `commitment_hash` as opaque calldata — it
            // never sees the secret, so it cannot check that the hash is the
            // hash of the entry beside it. Without these three asserts an
            // attacker registers an entry worth 1 wei under a commitment naming
            // 1001, then claims: the ledger is debited and the pool approved
            // for the CALLDATA amount while only the STORED amount leaves. One
            // wei zeroes `outstanding`, every other unclaimed payout becomes
            // unbacked and therefore permanently unclaimable, and the
            // difference reappears as `get_unattached` for the attacker to take.
            //
            // Cheap, and only ever fires on a registration that was malformed
            // to begin with: an honest entry necessarily matches its own
            // preimage.
            assert(entry.amount == amount, errors::TERMS_MISMATCH);
            assert(entry.token == token, errors::TERMS_MISMATCH);
            assert(entry.proposal_id == proposal_id, errors::TERMS_MISMATCH);

            // Measured in u256 throughout. v1 narrowed the balance to u128 with
            // try_into, which turns a large but perfectly legitimate treasury
            // into a panic that bricks every claim of that token.
            let outstanding_before = self.outstanding.read(entry.token);
            let erc20 = IErc20Dispatcher { contract_address: entry.token };
            let held = erc20.balance_of(get_contract_address());

            // `held >= outstanding_before`, not `held >= entry.amount`.
            //
            // The weak guard pays this claim out of a balance already promised
            // elsewhere, converting one loud revert now into a commitment that
            // is silently unbacked forever — and with no sweep, unfixable.
            assert(held >= outstanding_before, errors::UNBACKED_PAYOUT);
            assert(outstanding_before >= entry.amount.into(), errors::LEDGER_UNDERFLOW);

            // Effects before interaction, the ledger included: a reentrant
            // claim finds the entry taken and the ledger already decremented.
            self.payouts.write(commitment_hash, PayoutEntry { claimed: true, ..entry });
            let outstanding_after = outstanding_before - entry.amount.into();
            self.outstanding.write(entry.token, outstanding_after);

            // Approve, never transfer: the pool pulls with transfer_from when
            // it applies the deposit.
            erc20.approve(pool, entry.amount.into());

            self
                .emit(
                    Event::PayoutClaimed(
                        PayoutClaimed {
                            commitment_hash,
                            token: entry.token,
                            amount: entry.amount,
                            note_id,
                            outstanding_after,
                        },
                    ),
                );

            [OpenNoteDeposit { note_id, token: entry.token, amount: entry.amount }].span()
        }
    }
}
