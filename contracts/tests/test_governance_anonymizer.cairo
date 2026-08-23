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
    TallyProvenance,
    IProposalRegistryDispatcher, IProposalRegistryDispatcherTrait, Tally,
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
    let (address, _) = contract.deploy(@calldata).unwrap();

    let d = IProposalRegistryDispatcher { contract_address: address };
    cheat_caller_address(address, OWNER, CheatSpan::TargetCalls(1));
    start_cheat_block_number_global(START - 1);
    d.create_proposal('ipfs://payout-proposal', START, END, MIN_QUORUM, strk(), PAYOUT_CAP);

    start_cheat_block_number_global(END + 1);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.finalize(1, Tally { for_weight: 900, against_weight: 100, abstain_weight: 0 }, END, TallyProvenance::BallotDerived);

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
    let (address, _) = contract.deploy(@calldata).unwrap();

    let d = IProposalRegistryDispatcher { contract_address: address };
    cheat_caller_address(address, OWNER, CheatSpan::TargetCalls(1));
    start_cheat_block_number_global(START - 1);
    d.create_proposal('ipfs://rejected', START, END, MIN_QUORUM, strk(), PAYOUT_CAP);

    start_cheat_block_number_global(END + 1);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.finalize(1, Tally { for_weight: 100, against_weight: 900, abstain_weight: 0 }, END, TallyProvenance::BallotDerived);

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

fn register(address: ContractAddress, d: IGovernanceAnonymizerDispatcher) -> felt252 {
    let commitment = commitment_for(d, 1, AMOUNT, SECRET);
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    let out = d
        .privacy_invoke(
            GovernanceOperation::RegisterPayout, commitment, strk(), AMOUNT, 1, 0, 0,
        );
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
    d.privacy_invoke(
        GovernanceOperation::RegisterPayout, commitment_for(d, 1, AMOUNT, SECRET), strk(), AMOUNT, 1, 0,
        0,
    );
    stop_cheat_caller_address(address);
}

#[test]
#[should_panic(expected: 'PROPOSAL_NOT_PASSED')]
fn cannot_register_against_a_proposal_that_does_not_exist() {
    let (address, d) = setup();
    start_cheat_caller_address(address, POOL);
    d.privacy_invoke(
        GovernanceOperation::RegisterPayout, commitment_for(d, 999, AMOUNT, SECRET), strk(), AMOUNT, 999,
        0, 0,
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
    start_cheat_caller_address(address, POOL);
    d.privacy_invoke(
        GovernanceOperation::RegisterPayout, commitment_for(d, 1, AMOUNT, SECRET), strk(),
        AMOUNT * 10, 1, 0, 0,
    );
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
    d.privacy_invoke(
        GovernanceOperation::RegisterPayout, commitment_for(d, 1, AMOUNT, SECRET), strk(), AMOUNT, 1, 0,
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

    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    d.privacy_invoke(GovernanceOperation::RegisterPayout, commitment, strk(), AMOUNT, 1, 0, 0);

    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    let deposits = d
        .privacy_invoke(GovernanceOperation::Claim, 0, strk(), AMOUNT, 1, secret, NOTE_ID);

    assert!(deposits.len() == 1);
    assert!(*deposits.at(0) == aperture::governance_anonymizer::OpenNoteDeposit {
        note_id: NOTE_ID, token: strk(), amount: AMOUNT,
    });
}

#[test]
#[fuzzer(runs: 64)]
fn distinct_secrets_give_distinct_commitments(a: felt252, b: felt252) {
    if a == b {
        return;
    }
    assert!(
        compute_commitment_hash(0x1234, 1, strk(), AMOUNT, a)
            != compute_commitment_hash(0x1234, 1, strk(), AMOUNT, b),
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
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    d
        .privacy_invoke(
            GovernanceOperation::RegisterPayout,
            c433,
            strk(),
            AMOUNT,
            1,
            0,
            0,
        );
    assert_backed(address, d);

    let mut safe = IGovernanceAnonymizerSafeDispatcher { contract_address: address };
    let c448 = commitment_for(d, 1, 1, 'a second preimage');
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    match safe
        .privacy_invoke(
            GovernanceOperation::RegisterPayout,
            c448,
            strk(),
            1,
            1,
            0,
            0,
        ) {
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
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    d
        .privacy_invoke(
            GovernanceOperation::RegisterPayout,
            c471,
            strk(),
            AMOUNT,
            1,
            0,
            0,
        );
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
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    match safe
        .privacy_invoke(
            GovernanceOperation::RegisterPayout,
            c497,
            strk(),
            1,
            1,
            0,
            0,
        ) {
        Result::Ok(_) => panic!("registered against a balance the pool already pulled"),
        Result::Err(data) => assert!(*data.at(0) == 'HELPER_UNDERFUNDED'),
    }
}

#[test]
fn outstanding_is_tracked_per_token() {
    let (address, d) = setup();
    let c517 = commitment_for(d, 1, AMOUNT, SECRET);
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    d
        .privacy_invoke(
            GovernanceOperation::RegisterPayout,
            c517,
            strk(),
            AMOUNT,
            1,
            0,
            0,
        );

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
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    d
        .privacy_invoke(
            GovernanceOperation::RegisterPayout,
            c543,
            strk(),
            AMOUNT,
            1,
            0,
            0,
        );
    assert!(d.get_unattached(strk()) == 0, "fully committed now");
}

#[test]
fn zero_token_is_rejected() {
    // errors::ZERO_TOKEN existed in v1 and no test ever reached it.
    let (address, d) = setup();
    let mut safe = IGovernanceAnonymizerSafeDispatcher { contract_address: address };
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    let zero: ContractAddress = 0.try_into().unwrap();
    match safe
        .privacy_invoke(GovernanceOperation::RegisterPayout, 'c', zero, AMOUNT, 1, 0, 0) {
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
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    d
        .privacy_invoke(
            GovernanceOperation::RegisterPayout,
            c579,
            strk(),
            AMOUNT,
            1,
            0,
            0,
        );

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
    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    d
        .privacy_invoke(
            GovernanceOperation::RegisterPayout,
            c604,
            strk(),
            AMOUNT,
            1,
            0,
            0,
        );

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
    let commitment = compute_commitment_hash(
        0x1234, 1, strk(), 1000, 'a very secret preimage',
    );
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
