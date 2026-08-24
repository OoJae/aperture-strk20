//! `GovernanceAnonymizer` behaviour.
//!
//! The security story is narrow and worth testing hard: the pool is the only
//! caller, a payout only exists because a proposal passed, only the preimage
//! opens it, and it opens exactly once. The approve-don't-transfer contract is
//! checked by reading the allowance the pool would pull against.
//!
//! Uses snforge's predeployed STRK rather than a vendored mock, so the contract
//! keeps `starknet` as its only dependency.

use aperture::governance_anonymizer::{
    GovernanceOperation, IGovernanceAnonymizerDispatcher, IGovernanceAnonymizerDispatcherTrait,
    IGovernanceAnonymizerSafeDispatcher, IGovernanceAnonymizerSafeDispatcherTrait,
    compute_commitment_hash,
};
use aperture::proposal_registry::{
    IProposalRegistryDispatcher, IProposalRegistryDispatcherTrait, Tally, TallyProvenance,
};
use core::num::traits::Zero;
use snforge_std::{
    CheatSpan, ContractClassTrait, DeclareResultTrait, Token, TokenTrait, cheat_caller_address,
    declare, set_balance, start_cheat_block_number_global, start_cheat_caller_address,
    stop_cheat_caller_address,
};
use starknet::ContractAddress;

const POOL: ContractAddress = 0x0abc.try_into().unwrap();
const STRANGER: ContractAddress = 0x0bad.try_into().unwrap();
const OWNER: ContractAddress = 0x0111.try_into().unwrap();
const OPERATOR: ContractAddress = 0x0222.try_into().unwrap();

const CLASS_HASH: felt252 = 0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f;
const MASTER_PUB: felt252 = 0x1818d42721b097dd91b7495207bc12bd38c73bd66cdb7bcf38c4e41902c1d4b;

const START: u64 = 100;
const END: u64 = 200;
const CHAIN_ID: felt252 = 'SN_SEPOLIA';
const EPOCH: felt252 = 'APERTURE:V2:TEST';
const MIN_QUORUM: u128 = 1;
/// Zero for every test that is not about the timelock, so a confirmation does
/// not have to wait for blocks it does not care about.
const TIMELOCK: u64 = 0;
/// Generous, so cap tests can opt in explicitly rather than tripping by accident.
const PAYOUT_CAP: u128 = 1_000_000_000;
/// Zero on Sepolia in production; the tests that care set their own.
const ASSERTED_CAP: u128 = 0;
const AMOUNT: u128 = 1_000;
const SECRET: felt252 = 'a very secret preimage';
const NOTE_ID: felt252 = 0x1234;

/// Enough of ERC20 to check what the pool would be able to pull.
#[starknet::interface]
trait ITestErc20<TState> {
    fn balance_of(self: @TState, account: ContractAddress) -> u256;
    fn allowance(self: @TState, owner: ContractAddress, spender: ContractAddress) -> u256;
    fn transfer_from(
        ref self: TState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
}

fn strk() -> ContractAddress {
    Token::STRK.contract_address()
}

/// The commitment for the standard test payout.
///
/// v2 binds the terms into the preimage, so a commitment is only meaningful
/// against a specific domain, proposal, token and amount. Reading the domain
/// back from the deployed helper is also a check that the constructor cached
/// the registry's domain rather than something else.
fn commitment_for(
    d: IGovernanceAnonymizerDispatcher, proposal_id: u64, amount: u128, secret: felt252,
) -> felt252 {
    compute_commitment_hash(d.get_payout_domain(), proposal_id, strk(), amount, secret)
}

/// Registry with one finalized, passing proposal (id 1).
fn deploy_registry_with_passed_proposal() -> ContractAddress {
    let contract = declare("ProposalRegistry").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    OWNER.serialize(ref calldata);
    OPERATOR.serialize(ref calldata);
    CLASS_HASH.serialize(ref calldata);
    MASTER_PUB.serialize(ref calldata);
    CHAIN_ID.serialize(ref calldata);
    EPOCH.serialize(ref calldata);
    MIN_QUORUM.serialize(ref calldata);
    TIMELOCK.serialize(ref calldata);
    let (address, _) = contract.deploy(@calldata).unwrap();

    let d = IProposalRegistryDispatcher { contract_address: address };
    cheat_caller_address(address, OWNER, CheatSpan::TargetCalls(1));
    start_cheat_block_number_global(START - 1);
    d.create_proposal('ipfs://payout-proposal', START, END, MIN_QUORUM, strk(), PAYOUT_CAP);

    start_cheat_block_number_global(END + 1);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d
        .finalize(
            1,
            Tally { for_weight: 900, against_weight: 100, abstain_weight: 0 },
            END,
            TallyProvenance::BallotDerived,
            'ballot set commitment',
        );

    address
}

fn deploy_registry_with_failed_proposal() -> ContractAddress {
    let contract = declare("ProposalRegistry").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    OWNER.serialize(ref calldata);
    OPERATOR.serialize(ref calldata);
    CLASS_HASH.serialize(ref calldata);
    MASTER_PUB.serialize(ref calldata);
    CHAIN_ID.serialize(ref calldata);
    EPOCH.serialize(ref calldata);
    MIN_QUORUM.serialize(ref calldata);
    TIMELOCK.serialize(ref calldata);
    let (address, _) = contract.deploy(@calldata).unwrap();

    let d = IProposalRegistryDispatcher { contract_address: address };
    cheat_caller_address(address, OWNER, CheatSpan::TargetCalls(1));
    start_cheat_block_number_global(START - 1);
    d.create_proposal('ipfs://rejected', START, END, MIN_QUORUM, strk(), PAYOUT_CAP);

    start_cheat_block_number_global(END + 1);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d
        .finalize(
            1,
            Tally { for_weight: 100, against_weight: 900, abstain_weight: 0 },
            END,
            TallyProvenance::BallotDerived,
            'ballot set commitment',
        );

    address
}

/// Deploys the anonymizer and funds it as the pool's withdraw phase would.
fn setup() -> (ContractAddress, IGovernanceAnonymizerDispatcher) {
    let registry = deploy_registry_with_passed_proposal();
    let contract = declare("GovernanceAnonymizer").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    POOL.serialize(ref calldata);
    registry.serialize(ref calldata);
    ASSERTED_CAP.serialize(ref calldata);
    let (address, _) = contract.deploy(@calldata).unwrap();

    set_balance(address, AMOUNT.into(), Token::STRK);
    (address, IGovernanceAnonymizerDispatcher { contract_address: address })
}

/// The DAO committing budget to one specific payout, on the registry.
///
/// Every registration needs one. The anonymizer is handed value with no sender
/// — that is what it is for — so it cannot tell the DAO's money from a
/// stranger's, and the budget has to be spent where the caller is known.
/// Without this, anyone could burn a passed proposal's cap to zero for good by
/// escrowing their own funds and claiming them straight back.
fn authorize(
    d: IGovernanceAnonymizerDispatcher, proposal_id: u64, commitment: felt252, amount: u128,
) {
    let registry = d.get_registry();
    let dispatcher = IProposalRegistryDispatcher { contract_address: registry };
    // Two calls now: announcing starts the timelock, confirming grants the
    // licence. TIMELOCK is zero in these tests, so the two can share a block.
    cheat_caller_address(registry, OPERATOR, CheatSpan::TargetCalls(1));
    dispatcher.announce_payout(proposal_id, commitment, amount);
    cheat_caller_address(registry, OPERATOR, CheatSpan::TargetCalls(1));
    dispatcher.authorize_payout(commitment);
}

fn register(address: ContractAddress, d: IGovernanceAnonymizerDispatcher) -> felt252 {
    let commitment = commitment_for(d, 1, AMOUNT, SECRET);
    authorize(d, 1, commitment, AMOUNT);
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    let out = d
        .privacy_invoke(GovernanceOperation::RegisterPayout, commitment, strk(), AMOUNT, 1, 0, 0);
    assert!(out.len() == 0, "registering must credit nothing");
    commitment
}

// --- access control -------------------------------------------------------

#[test]
#[should_panic(expected: 'CALLER_NOT_POOL')]
fn only_the_pool_may_register() {
    let (address, d) = setup();
    start_cheat_caller_address(address, STRANGER);
    d.privacy_invoke(GovernanceOperation::RegisterPayout, 0x11, strk(), AMOUNT, 1, 0, 0);
    stop_cheat_caller_address(address);
}

#[test]
#[should_panic(expected: 'CALLER_NOT_POOL')]
fn only_the_pool_may_claim() {
    let (address, d) = setup();
    start_cheat_caller_address(address, STRANGER);
    d.privacy_invoke(GovernanceOperation::Claim, 0, strk(), AMOUNT, 1, SECRET, NOTE_ID);
    stop_cheat_caller_address(address);
}

// --- the proposal gate ----------------------------------------------------

#[test]
#[should_panic(expected: 'PROPOSAL_NOT_PASSED')]
fn cannot_register_against_a_rejected_proposal() {
    let registry = deploy_registry_with_failed_proposal();
    let contract = declare("GovernanceAnonymizer").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    POOL.serialize(ref calldata);
    registry.serialize(ref calldata);
    ASSERTED_CAP.serialize(ref calldata);
    let (address, _) = contract.deploy(@calldata).unwrap();
    set_balance(address, AMOUNT.into(), Token::STRK);

    let d = IGovernanceAnonymizerDispatcher { contract_address: address };
    start_cheat_caller_address(address, POOL);
    d
        .privacy_invoke(
            GovernanceOperation::RegisterPayout,
            commitment_for(d, 1, AMOUNT, SECRET),
            strk(),
            AMOUNT,
            1,
            0,
            0,
        );
    stop_cheat_caller_address(address);
}

#[test]
#[should_panic(expected: 'PROPOSAL_NOT_PASSED')]
fn cannot_register_against_a_proposal_that_does_not_exist() {
    let (address, d) = setup();
    start_cheat_caller_address(address, POOL);
    d
        .privacy_invoke(
            GovernanceOperation::RegisterPayout,
            commitment_for(d, 999, AMOUNT, SECRET),
            strk(),
            AMOUNT,
            999,
            0,
            0,
        );
    stop_cheat_caller_address(address);
}

// --- input validation -----------------------------------------------------

#[test]
#[should_panic(expected: 'ZERO_COMMITMENT_HASH')]
fn commitment_hash_must_be_non_zero() {
    let (address, d) = setup();
    start_cheat_caller_address(address, POOL);
    d.privacy_invoke(GovernanceOperation::RegisterPayout, 0, strk(), AMOUNT, 1, 0, 0);
    stop_cheat_caller_address(address);
}

#[test]
#[should_panic(expected: 'ZERO_AMOUNT')]
fn amount_must_be_non_zero() {
    let (address, d) = setup();
    start_cheat_caller_address(address, POOL);
    d.privacy_invoke(GovernanceOperation::RegisterPayout, 0x11, strk(), 0, 1, 0, 0);
    stop_cheat_caller_address(address);
}

#[test]
#[should_panic(expected: 'HELPER_UNDERFUNDED')]
fn cannot_register_more_than_the_pool_actually_sent() {
    let (address, d) = setup();
    // Licensed for the full amount, so the test still reaches the ledger check
    // rather than stopping at the licence.
    let commitment = commitment_for(d, 1, AMOUNT, SECRET);
    authorize(d, 1, commitment, AMOUNT * 10);
    start_cheat_caller_address(address, POOL);
    d.privacy_invoke(GovernanceOperation::RegisterPayout, commitment, strk(), AMOUNT * 10, 1, 0, 0);
    stop_cheat_caller_address(address);
}

// --- lifecycle ------------------------------------------------------------

#[test]
fn register_then_claim_credits_an_open_note() {
    let (address, d) = setup();
    let commitment = register(address, d);

    let entry = d.get_payout(commitment);
    assert!(entry.token == strk() && entry.amount == AMOUNT, "entry should round-trip");
    assert!(entry.proposal_id == 1);
    assert!(!entry.claimed, "not claimed yet");

    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    let deposits = d
        .privacy_invoke(GovernanceOperation::Claim, 0, strk(), AMOUNT, 1, SECRET, NOTE_ID);

    assert!(deposits.len() == 1, "claim should credit exactly one note");
    let deposit = *deposits.at(0);
    assert!(deposit.note_id == NOTE_ID);
    assert!(deposit.token == strk());
    assert!(deposit.amount == AMOUNT);

    assert!(d.get_payout(commitment).claimed, "entry should now be spent");
}

/// The load-bearing half of "approve, don't transfer": the pool can only pull
/// what we approved, and we never moved the tokens ourselves.
#[test]
fn claiming_approves_the_pool_rather_than_transferring() {
    let (address, d) = setup();
    register(address, d);

    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    d.privacy_invoke(GovernanceOperation::Claim, 0, strk(), AMOUNT, 1, SECRET, NOTE_ID);

    let token = ITestErc20Dispatcher { contract_address: strk() };
    assert!(
        token.allowance(address, POOL) == AMOUNT.into(),
        "pool should be approved for exactly the payout",
    );
    assert!(
        token.balance_of(address) == AMOUNT.into(),
        "helper still holds the tokens until the pool pulls them",
    );
}

#[test]
#[should_panic(expected: 'COMMITMENT_NOT_FOUND')]
fn a_wrong_secret_opens_nothing() {
    let (address, d) = setup();
    register(address, d);

    start_cheat_caller_address(address, POOL);
    d.privacy_invoke(GovernanceOperation::Claim, 0, strk(), AMOUNT, 1, 'wrong secret', NOTE_ID);
    stop_cheat_caller_address(address);
}

#[test]
#[should_panic(expected: 'COMMITMENT_EXISTS')]
fn the_same_commitment_cannot_be_registered_twice() {
    let (address, d) = setup();
    register(address, d);

    start_cheat_caller_address(address, POOL);
    d
        .privacy_invoke(
            GovernanceOperation::RegisterPayout,
            commitment_for(d, 1, AMOUNT, SECRET),
            strk(),
            AMOUNT,
            1,
            0,
            0,
        );
    stop_cheat_caller_address(address);
}

/// Safe dispatcher, because the first claim must succeed inside the same test.
#[test]
#[feature("safe_dispatcher")]
fn a_payout_cannot_be_claimed_twice() {
    let (address, d) = setup();
    register(address, d);
    let safe = IGovernanceAnonymizerSafeDispatcher { contract_address: address };

    start_cheat_caller_address(address, POOL);
    safe.privacy_invoke(GovernanceOperation::Claim, 0, strk(), AMOUNT, 1, SECRET, NOTE_ID).unwrap();

    match safe.privacy_invoke(GovernanceOperation::Claim, 0, strk(), AMOUNT, 1, SECRET, NOTE_ID) {
        Result::Ok(_) => panic!("a second claim should have reverted"),
        Result::Err(panic_data) => { assert!(*panic_data.at(0) == 'ALREADY_CLAIMED'); },
    }
    stop_cheat_caller_address(address);
}

/// The commitment hash passed in calldata is ignored — only the preimage counts.
#[test]
fn a_forged_commitment_hash_in_calldata_is_ignored() {
    let (address, d) = setup();
    let commitment = register(address, d);

    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    let deposits = d
        .privacy_invoke(
            GovernanceOperation::Claim,
            'a hash the caller made up',
            strk(),
            AMOUNT,
            1,
            SECRET,
            NOTE_ID,
        );

    assert!(deposits.len() == 1, "the real preimage should still work");
    assert!(d.get_payout(commitment).claimed);
}

#[test]
fn constructor_records_pool_and_registry() {
    let (_, d) = setup();
    assert!(d.get_pool() == POOL);
    assert!(d.get_registry().is_non_zero());
}

// --- fuzzing --------------------------------------------------------------

/// Any secret produces a commitment that only that secret can open.
#[test]
#[fuzzer(runs: 64)]
fn claim_round_trips_for_any_secret(secret: felt252) {
    if secret == 0 {
        return;
    }
    let (address, d) = setup();
    let commitment = commitment_for(d, 1, AMOUNT, secret);
    authorize(d, 1, commitment, AMOUNT);

    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    d.privacy_invoke(GovernanceOperation::RegisterPayout, commitment, strk(), AMOUNT, 1, 0, 0);

    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    let deposits = d
        .privacy_invoke(GovernanceOperation::Claim, 0, strk(), AMOUNT, 1, secret, NOTE_ID);

    assert!(deposits.len() == 1);
    assert!(
        *deposits
            .at(
                0,
            ) == aperture::governance_anonymizer::OpenNoteDeposit {
                note_id: NOTE_ID, token: strk(), amount: AMOUNT,
            },
    );
}

#[test]
#[fuzzer(runs: 64)]
fn distinct_secrets_give_distinct_commitments(a: felt252, b: felt252) {
    if a == b {
        return;
    }
    assert!(
        compute_commitment_hash(
            0x1234, 1, strk(), AMOUNT, a,
        ) != compute_commitment_hash(0x1234, 1, strk(), AMOUNT, b),
    );
}


// --- the escrow ledger ----------------------------------------------------
//
// v1 checked each payout against the absolute balance with no running total, so
// N payouts could be registered against one balance and the last N-1 claims
// would find nothing left. These are the tests that would have caught it.
//
// They only mean anything with `pool_pulls`. The suite never simulated the pool
// collecting its allowance, so a claim left the helper's balance untouched and
// every ledger assertion below would have passed against a number standing
// still.

/// What the pool does next, in the same transaction: pull the allowance the
/// claim just granted. The cheat targets the TOKEN, because `transfer_from`
/// checks the token's caller rather than the helper's.
fn pool_pulls(helper: ContractAddress, amount: u128) {
    cheat_caller_address(strk(), POOL, CheatSpan::TargetCalls(1));
    ITestErc20Dispatcher { contract_address: strk() }.transfer_from(helper, POOL, amount.into());
}

fn held(helper: ContractAddress) -> u256 {
    ITestErc20Dispatcher { contract_address: strk() }.balance_of(helper)
}

/// The invariant this contract exists to keep.
fn assert_backed(helper: ContractAddress, d: IGovernanceAnonymizerDispatcher) {
    assert!(
        held(helper) >= d.get_outstanding(strk()),
        "escrow invariant broken: the helper owes more than it holds",
    );
}

#[test]
fn two_distinct_commitments_cannot_share_one_balance() {
    // THE v1 DRAIN. Two different commitments, one balance. v1 admitted both,
    // and whichever claimed second found nothing — permanently, since there is
    // no sweep and `claimed` stays false.
    let (address, d) = setup(); // funded with exactly AMOUNT

    let c433 = commitment_for(d, 1, AMOUNT, SECRET);
    authorize(d, 1, c433, AMOUNT);
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    d.privacy_invoke(GovernanceOperation::RegisterPayout, c433, strk(), AMOUNT, 1, 0, 0);
    assert_backed(address, d);

    let mut safe = IGovernanceAnonymizerSafeDispatcher { contract_address: address };
    let c448 = commitment_for(d, 1, 1, 'a second preimage');
    authorize(d, 1, c448, 1);
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    match safe.privacy_invoke(GovernanceOperation::RegisterPayout, c448, strk(), 1, 1, 0, 0) {
        Result::Ok(_) => panic!("a second payout was registered against a balance already owed"),
        Result::Err(data) => assert!(*data.at(0) == 'HELPER_UNDERFUNDED'),
    }
}

#[test]
fn a_claim_interleaved_between_two_registrations() {
    // Register A, claim A, let the pool pull, then register B against what is
    // left. The ledger has to be right at all four points, not just the ends.
    let (address, d) = setup();

    let c471 = commitment_for(d, 1, AMOUNT, SECRET);
    authorize(d, 1, c471, AMOUNT);
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    d.privacy_invoke(GovernanceOperation::RegisterPayout, c471, strk(), AMOUNT, 1, 0, 0);
    assert!(d.get_outstanding(strk()) == AMOUNT.into());
    assert_backed(address, d);

    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    d.privacy_invoke(GovernanceOperation::Claim, 0, strk(), AMOUNT, 1, SECRET, NOTE_ID);
    assert!(d.get_outstanding(strk()) == 0, "claiming must release the escrow");

    pool_pulls(address, AMOUNT);
    assert!(held(address) == 0, "the pool should have taken it");
    assert_backed(address, d);

    // Nothing is left, so a further registration must fail rather than promise
    // value that is gone.
    let mut safe = IGovernanceAnonymizerSafeDispatcher { contract_address: address };
    let c497 = commitment_for(d, 1, 1, 'later preimage');
    authorize(d, 1, c497, 1);
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    match safe.privacy_invoke(GovernanceOperation::RegisterPayout, c497, strk(), 1, 1, 0, 0) {
        Result::Ok(_) => panic!("registered against a balance the pool already pulled"),
        Result::Err(data) => assert!(*data.at(0) == 'HELPER_UNDERFUNDED'),
    }
}

#[test]
fn outstanding_is_tracked_per_token() {
    let (address, d) = setup();
    let c517 = commitment_for(d, 1, AMOUNT, SECRET);
    authorize(d, 1, c517, AMOUNT);
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    d.privacy_invoke(GovernanceOperation::RegisterPayout, c517, strk(), AMOUNT, 1, 0, 0);

    assert!(d.get_outstanding(strk()) == AMOUNT.into());
    // A different token shares no ledger with STRK.
    let other: ContractAddress = 0x0999.try_into().unwrap();
    assert!(d.get_outstanding(other) == 0);
}

#[test]
fn get_unattached_reports_value_nobody_can_move() {
    // The 14-STRK shape: value sent without a commitment. Visible, and
    // permanently stuck, by design.
    let (address, d) = setup();
    assert!(d.get_unattached(strk()) == AMOUNT.into(), "unattached before any registration");

    let c543 = commitment_for(d, 1, AMOUNT, SECRET);
    authorize(d, 1, c543, AMOUNT);
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    d.privacy_invoke(GovernanceOperation::RegisterPayout, c543, strk(), AMOUNT, 1, 0, 0);
    assert!(d.get_unattached(strk()) == 0, "fully committed now");
}

#[test]
fn zero_token_is_rejected() {
    // errors::ZERO_TOKEN existed in v1 and no test ever reached it.
    let (address, d) = setup();
    let mut safe = IGovernanceAnonymizerSafeDispatcher { contract_address: address };
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    let zero: ContractAddress = 0.try_into().unwrap();
    match safe.privacy_invoke(GovernanceOperation::RegisterPayout, 'c', zero, AMOUNT, 1, 0, 0) {
        Result::Ok(_) => panic!("a zero token was accepted"),
        Result::Err(data) => assert!(*data.at(0) == 'ZERO_TOKEN'),
    }
}

#[test]
fn the_commitment_binds_the_amount() {
    // A holder of the secret must not be able to open for more than was
    // escrowed. In v1 the preimage was the secret alone, so the amount was
    // whatever the stored entry said and the secret was portable across
    // entries.
    let (address, d) = setup();
    let c579 = commitment_for(d, 1, AMOUNT, SECRET);
    authorize(d, 1, c579, AMOUNT);
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    d.privacy_invoke(GovernanceOperation::RegisterPayout, c579, strk(), AMOUNT, 1, 0, 0);

    let mut safe = IGovernanceAnonymizerSafeDispatcher { contract_address: address };
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    match safe
        .privacy_invoke(GovernanceOperation::Claim, 0, strk(), AMOUNT * 2, 1, SECRET, NOTE_ID) {
        Result::Ok(_) => panic!("the secret opened a larger payout than it was minted for"),
        Result::Err(data) => assert!(*data.at(0) == 'COMMITMENT_NOT_FOUND'),
    }
}

#[test]
fn the_commitment_binds_the_proposal() {
    let (address, d) = setup();
    let c604 = commitment_for(d, 1, AMOUNT, SECRET);
    authorize(d, 1, c604, AMOUNT);
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    d.privacy_invoke(GovernanceOperation::RegisterPayout, c604, strk(), AMOUNT, 1, 0, 0);

    let mut safe = IGovernanceAnonymizerSafeDispatcher { contract_address: address };
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    match safe.privacy_invoke(GovernanceOperation::Claim, 0, strk(), AMOUNT, 2, SECRET, NOTE_ID) {
        Result::Ok(_) => panic!("the secret opened a payout for another proposal"),
        Result::Err(data) => assert!(*data.at(0) == 'COMMITMENT_NOT_FOUND'),
    }
}


/// Pinned identically in packages/strk20-governance/tests/payout.test.ts and
/// computed there by an independent implementation.
///
/// This is the test whose absence let four implementations of this hash drift
/// apart. A drifted client still registers — the contract stores whatever hash
/// it is given — and then can never claim, because only the claim recomputes
/// the preimage. Two balances have been lost that way.
#[test]
fn commitment_matches_the_typescript_vector() {
    let commitment = compute_commitment_hash(0x1234, 1, strk(), 1000, 'a very secret preimage');
    assert!(
        commitment == 0xe9ed710c9e38c75880ecd742a47a3dc1e7ae641537aeb4aa00eeb361176e1c,
        "the commitment must match the TypeScript implementation",
    );
}

/// A fuzz test over distinct secrets passes for `hash(s) = s`. Only a fixed
/// vector rules that out, and v1 had only the fuzz test.
#[test]
fn the_commitment_is_not_the_identity_function() {
    let secret = 'a very secret preimage';
    let commitment = compute_commitment_hash(0x1234, 1, strk(), 1000, secret);
    assert!(commitment != secret, "the commitment must not be the secret itself");
    assert!(commitment != 0x1234, "nor the domain");
}

// --- the mismatched-registration attack -----------------------------------
//
// register_payout cannot verify that the commitment hash it is handed
// describes the entry it stores beside it, because it never sees the secret.
// That is unavoidable. What is avoidable is claim() trusting the calldata for
// anything that moves value, which is what the v2 draft did: it debited the
// ledger and set the pool's allowance from the CALLDATA amount while returning
// the STORED amount to the pool.
//
// The suite had `the_commitment_binds_the_amount`, which only tested the honest
// direction — claiming MORE than an honest entry holds. It passed. This is the
// dishonest direction, and it is where the money was.
//
// `authorize_payout` narrows who can reach this — a registration now needs the
// tally operator's licence — but it cannot close it. The registry does not see
// the secret either, so its licence pins the amount escrowed, never the amount
// the commitment names. A mint built wrong by the DAO's own tooling still
// produces this entry, and claim() is the only place the two amounts meet.

#[test]
#[should_panic(expected: 'TERMS_MISMATCH')]
fn a_registration_whose_commitment_lies_about_its_amount_cannot_be_claimed() {
    let (address, d) = setup();

    // A commitment that names AMOUNT, stored against an entry worth 1 wei.
    let lying_commitment = commitment_for(d, 1, AMOUNT, SECRET);
    // The licence pins the amount ESCROWED, not the amount the commitment
    // names — the registry never sees the secret either. So a malformed mint
    // survives the licence, and claim() is the only place the two can be
    // compared.
    authorize(d, 1, lying_commitment, 1);
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    d.privacy_invoke(GovernanceOperation::RegisterPayout, lying_commitment, strk(), 1, 1, 0, 0);

    // Claiming with the amount the commitment names finds the 1-wei entry.
    // Before the fix this debited `outstanding` by AMOUNT and approved the pool
    // for AMOUNT while moving 1 wei — zeroing the ledger and stranding every
    // other payout.
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    d.privacy_invoke(GovernanceOperation::Claim, 0, strk(), AMOUNT, 1, SECRET, NOTE_ID);
}

#[test]
fn a_lying_registration_cannot_strand_an_honest_payout() {
    // The consequence, stated as a property: an honest payout registered first
    // must still be claimable after an attacker's malformed one is rejected.
    let (address, d) = setup();

    let honest = commitment_for(d, 1, AMOUNT, SECRET);
    authorize(d, 1, honest, AMOUNT);
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    d.privacy_invoke(GovernanceOperation::RegisterPayout, honest, strk(), AMOUNT, 1, 0, 0);
    assert!(d.get_outstanding(strk()) == AMOUNT.into());

    // Fund one extra wei so the attacker's registration is itself backed.
    set_balance(address, (AMOUNT + 1).into(), Token::STRK);

    let lying = commitment_for(d, 1, AMOUNT, 'another preimage');
    authorize(d, 1, lying, 1);
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    d.privacy_invoke(GovernanceOperation::RegisterPayout, lying, strk(), 1, 1, 0, 0);

    let mut safe = IGovernanceAnonymizerSafeDispatcher { contract_address: address };
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    match safe
        .privacy_invoke(
            GovernanceOperation::Claim, 0, strk(), AMOUNT, 1, 'another preimage', NOTE_ID,
        ) {
        Result::Ok(_) => panic!("a commitment that lied about its amount was honoured"),
        Result::Err(data) => assert!(*data.at(0) == 'TERMS_MISMATCH'),
    }

    // The ledger still owes the honest payout plus the attacker's own 1 wei,
    // which is legitimately escrowed — they really did put it in. What must not
    // have happened is the ledger being debited by the amount the commitment
    // merely *named*.
    assert!(
        d.get_outstanding(strk()) == (AMOUNT + 1).into(),
        "the ledger must reflect only what was actually escrowed",
    );
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    let deposits = d
        .privacy_invoke(GovernanceOperation::Claim, 0, strk(), AMOUNT, 1, SECRET, NOTE_ID);
    assert!(
        *deposits
            .at(
                0,
            ) == aperture::governance_anonymizer::OpenNoteDeposit {
                note_id: NOTE_ID, token: strk(), amount: AMOUNT,
            },
    );
    // Only the attacker's own wei remains owed.
    assert!(d.get_outstanding(strk()) == 1);
}

#[test]
fn a_claim_naming_the_wrong_terms_finds_no_entry_at_all() {
    // The token and the proposal are bound into the preimage, so naming
    // different ones recomputes a different hash and lands on an empty slot —
    // COMMITMENT_NOT_FOUND, before TERMS_MISMATCH can be reached. The token and
    // proposal asserts in claim() are therefore defence in depth rather than
    // the primary guard, and only the amount assert is load-bearing: the amount
    // is the one term register_payout stores from calldata that the payout
    // terms do not already pin.
    let (address, d) = setup();
    let commitment = commitment_for(d, 1, AMOUNT, SECRET);
    authorize(d, 1, commitment, AMOUNT);
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    d.privacy_invoke(GovernanceOperation::RegisterPayout, commitment, strk(), AMOUNT, 1, 0, 0);

    let mut safe = IGovernanceAnonymizerSafeDispatcher { contract_address: address };
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    match safe.privacy_invoke(GovernanceOperation::Claim, 0, strk(), AMOUNT, 2, SECRET, NOTE_ID) {
        Result::Ok(_) => panic!("a claim naming another proposal was honoured"),
        Result::Err(data) => assert!(*data.at(0) == 'COMMITMENT_NOT_FOUND'),
    }
}

// --- the cap-burning grief ------------------------------------------------
//
// Everything the anonymizer can check about a registration is satisfied by a
// stranger: `terms.passed` is a permanent public fact, and being the pool means
// nothing, because the pool relays anybody's private transaction. So before the
// licence, an attacker could escrow their own money against a passed proposal,
// claim it straight back through the same anonymizer, and walk away having
// moved `spent` — which never decreases — to the cap. With no owner, no sweep
// and no upgrade, every later payout under that proposal would then fail
// PAYOUT_CAP_EXCEEDED for good. Two pool fees, and the attacker keeps their
// money.

#[test]
#[should_panic(expected: 'PAYOUT_NOT_AUTHORIZED')]
fn a_stranger_cannot_escrow_against_a_passed_proposal() {
    let (address, d) = setup();
    let commitment = commitment_for(d, 1, AMOUNT, SECRET);
    // Everything except the licence.
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    d.privacy_invoke(GovernanceOperation::RegisterPayout, commitment, strk(), AMOUNT, 1, 0, 0);
}

#[test]
#[feature("safe_dispatcher")]
fn a_rejected_registration_burns_none_of_the_budget() {
    // The property, not just the revert: after the attempt, the DAO's own
    // payout still registers and still claims.
    let (address, d) = setup();
    let safe = IGovernanceAnonymizerSafeDispatcher { contract_address: address };

    let attacker = commitment_for(d, 1, AMOUNT, 'attacker preimage');
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    match safe
        .privacy_invoke(GovernanceOperation::RegisterPayout, attacker, strk(), AMOUNT, 1, 0, 0) {
        Result::Ok(_) => panic!("an unlicensed registration was accepted"),
        Result::Err(data) => assert!(*data.at(0) == 'PAYOUT_NOT_AUTHORIZED'),
    }
    assert!(d.get_spent(1) == 0, "a rejected registration must spend no budget");
    assert!(d.get_outstanding(strk()) == 0, "nor escrow anything");

    let commitment = register(address, d);
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    let deposits = d
        .privacy_invoke(GovernanceOperation::Claim, 0, strk(), AMOUNT, 1, SECRET, NOTE_ID);
    assert!(
        *deposits
            .at(
                0,
            ) == aperture::governance_anonymizer::OpenNoteDeposit {
                note_id: NOTE_ID, token: strk(), amount: AMOUNT,
            },
    );
    assert!(d.get_payout(commitment).claimed);
}

#[test]
#[should_panic(expected: 'PAYOUT_NOT_AUTHORIZED')]
fn a_licence_does_not_stretch_to_a_larger_escrow() {
    // The licence names an amount, and it is the amount that gets escrowed —
    // otherwise a 1-wei licence would admit a registration for the whole cap.
    let (address, d) = setup();
    let commitment = commitment_for(d, 1, AMOUNT, SECRET);
    authorize(d, 1, commitment, AMOUNT / 2);
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    d.privacy_invoke(GovernanceOperation::RegisterPayout, commitment, strk(), AMOUNT, 1, 0, 0);
}

#[test]
#[should_panic(expected: 'PAYOUT_NOT_AUTHORIZED')]
fn a_licence_issued_for_one_commitment_does_not_cover_another() {
    let (address, d) = setup();
    let licensed = commitment_for(d, 1, AMOUNT, SECRET);
    authorize(d, 1, licensed, AMOUNT);

    let unlicensed = commitment_for(d, 1, AMOUNT, 'a different preimage');
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    d.privacy_invoke(GovernanceOperation::RegisterPayout, unlicensed, strk(), AMOUNT, 1, 0, 0);
}
