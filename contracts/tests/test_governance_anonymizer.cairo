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
const AMOUNT: u128 = 1_000;
const SECRET: felt252 = 'a very secret preimage';
const NOTE_ID: felt252 = 0x1234;

/// Enough of ERC20 to check what the pool would be able to pull.
#[starknet::interface]
trait ITestErc20<TState> {
    fn balance_of(self: @TState, account: ContractAddress) -> u256;
    fn allowance(self: @TState, owner: ContractAddress, spender: ContractAddress) -> u256;
}

fn strk() -> ContractAddress {
    Token::STRK.contract_address()
}

/// Registry with one finalized, passing proposal (id 1).
fn deploy_registry_with_passed_proposal() -> ContractAddress {
    let contract = declare("ProposalRegistry").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    OWNER.serialize(ref calldata);
    OPERATOR.serialize(ref calldata);
    CLASS_HASH.serialize(ref calldata);
    MASTER_PUB.serialize(ref calldata);
    let (address, _) = contract.deploy(@calldata).unwrap();

    let d = IProposalRegistryDispatcher { contract_address: address };
    cheat_caller_address(address, OWNER, CheatSpan::TargetCalls(1));
    d.create_proposal('ipfs://payout-proposal', START, END);

    start_cheat_block_number_global(END + 1);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.finalize(1, Tally { for_weight: 900, against_weight: 100, abstain_weight: 0 });

    address
}

fn deploy_registry_with_failed_proposal() -> ContractAddress {
    let contract = declare("ProposalRegistry").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    OWNER.serialize(ref calldata);
    OPERATOR.serialize(ref calldata);
    CLASS_HASH.serialize(ref calldata);
    MASTER_PUB.serialize(ref calldata);
    let (address, _) = contract.deploy(@calldata).unwrap();

    let d = IProposalRegistryDispatcher { contract_address: address };
    cheat_caller_address(address, OWNER, CheatSpan::TargetCalls(1));
    d.create_proposal('ipfs://rejected', START, END);

    start_cheat_block_number_global(END + 1);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.finalize(1, Tally { for_weight: 100, against_weight: 900, abstain_weight: 0 });

    address
}

/// Deploys the anonymizer and funds it as the pool's withdraw phase would.
fn setup() -> (ContractAddress, IGovernanceAnonymizerDispatcher) {
    let registry = deploy_registry_with_passed_proposal();
    let contract = declare("GovernanceAnonymizer").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    POOL.serialize(ref calldata);
    registry.serialize(ref calldata);
    let (address, _) = contract.deploy(@calldata).unwrap();

    set_balance(address, AMOUNT.into(), Token::STRK);
    (address, IGovernanceAnonymizerDispatcher { contract_address: address })
}

fn register(address: ContractAddress, d: IGovernanceAnonymizerDispatcher) -> felt252 {
    let commitment = compute_commitment_hash(SECRET);
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
    d.privacy_invoke(GovernanceOperation::Claim, 0, strk(), 0, 0, SECRET, NOTE_ID);
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
    let (address, _) = contract.deploy(@calldata).unwrap();
    set_balance(address, AMOUNT.into(), Token::STRK);

    let d = IGovernanceAnonymizerDispatcher { contract_address: address };
    start_cheat_caller_address(address, POOL);
    d.privacy_invoke(
        GovernanceOperation::RegisterPayout, compute_commitment_hash(SECRET), strk(), AMOUNT, 1, 0,
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
        GovernanceOperation::RegisterPayout, compute_commitment_hash(SECRET), strk(), AMOUNT, 999,
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
#[should_panic(expected: 'INSUFFICIENT_BALANCE')]
fn cannot_register_more_than_the_pool_actually_sent() {
    let (address, d) = setup();
    start_cheat_caller_address(address, POOL);
    d.privacy_invoke(
        GovernanceOperation::RegisterPayout, compute_commitment_hash(SECRET), strk(),
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
        .privacy_invoke(GovernanceOperation::Claim, 0, strk(), 0, 0, SECRET, NOTE_ID);

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
    d.privacy_invoke(GovernanceOperation::Claim, 0, strk(), 0, 0, SECRET, NOTE_ID);

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
    d.privacy_invoke(GovernanceOperation::Claim, 0, strk(), 0, 0, 'wrong secret', NOTE_ID);
    stop_cheat_caller_address(address);
}

#[test]
#[should_panic(expected: 'COMMITMENT_EXISTS')]
fn the_same_commitment_cannot_be_registered_twice() {
    let (address, d) = setup();
    register(address, d);

    start_cheat_caller_address(address, POOL);
    d.privacy_invoke(
        GovernanceOperation::RegisterPayout, compute_commitment_hash(SECRET), strk(), AMOUNT, 1, 0,
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
    safe.privacy_invoke(GovernanceOperation::Claim, 0, strk(), 0, 0, SECRET, NOTE_ID).unwrap();

    match safe.privacy_invoke(GovernanceOperation::Claim, 0, strk(), 0, 0, SECRET, NOTE_ID) {
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
            GovernanceOperation::Claim, 'a hash the caller made up', strk(), 0, 0, SECRET, NOTE_ID,
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
    let commitment = compute_commitment_hash(secret);

    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    d.privacy_invoke(GovernanceOperation::RegisterPayout, commitment, strk(), AMOUNT, 1, 0, 0);

    cheat_caller_address(address, POOL, CheatSpan::TargetCalls(1));
    let deposits = d
        .privacy_invoke(GovernanceOperation::Claim, 0, strk(), 0, 0, secret, NOTE_ID);

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
    assert!(compute_commitment_hash(a) != compute_commitment_hash(b));
}
