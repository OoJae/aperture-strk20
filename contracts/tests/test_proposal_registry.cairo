//! `ProposalRegistry` behaviour.
//!
//! The registry is deliberately public, so most of what is worth testing is
//! access control and the finalize-once discipline: nothing should be able to
//! post a tally early, twice, or without being the tally operator.

use aperture::ballot::Choice;
use aperture::proposal_registry::{
    IProposalRegistryDispatcher, IProposalRegistryDispatcherTrait,
    IProposalRegistrySafeDispatcher, IProposalRegistrySafeDispatcherTrait, Tally,
};
use snforge_std::{
    CheatSpan, ContractClassTrait, DeclareResultTrait, cheat_caller_address, declare,
    start_cheat_block_number_global, start_cheat_caller_address, stop_cheat_caller_address,
};
use starknet::ContractAddress;

const OWNER: ContractAddress = 0x0111.try_into().unwrap();
const OPERATOR: ContractAddress = 0x0222.try_into().unwrap();
const STRANGER: ContractAddress = 0x0bad.try_into().unwrap();

const CLASS_HASH: felt252 = 0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f;
const MASTER_PUB: felt252 = 0x1818d42721b097dd91b7495207bc12bd38c73bd66cdb7bcf38c4e41902c1d4b;

const START: u64 = 100;
const END: u64 = 200;

fn deploy() -> (ContractAddress, IProposalRegistryDispatcher) {
    let contract = declare("ProposalRegistry").unwrap().contract_class();
    // Built with Serde rather than by hand: a hand-rolled array silently breaks
    // for any multi-felt type.
    let mut calldata: Array<felt252> = array![];
    OWNER.serialize(ref calldata);
    OPERATOR.serialize(ref calldata);
    CLASS_HASH.serialize(ref calldata);
    MASTER_PUB.serialize(ref calldata);

    let (address, _) = contract.deploy(@calldata).unwrap();
    (address, IProposalRegistryDispatcher { contract_address: address })
}

fn create_default_proposal(address: ContractAddress, d: IProposalRegistryDispatcher) -> u64 {
    cheat_caller_address(address, OWNER, CheatSpan::TargetCalls(1));
    d.create_proposal('ipfs://proposal-1', START, END)
}

#[test]
fn owner_can_create_a_proposal() {
    let (address, d) = deploy();
    let id = create_default_proposal(address, d);

    assert!(id == 1, "first proposal should be id 1");
    assert!(d.proposal_count() == 1);

    let p = d.get_proposal(id);
    assert!(p.proposer == OWNER);
    assert!(p.metadata_uri == 'ipfs://proposal-1');
    assert!(p.start_block == START && p.end_block == END);
    assert!(!p.finalized, "a fresh proposal is not finalized");
}

#[test]
#[should_panic(expected: 'NOT_ALLOWED_PROPOSER')]
fn stranger_cannot_create_a_proposal() {
    let (address, d) = deploy();
    start_cheat_caller_address(address, STRANGER);
    d.create_proposal('ipfs://nope', START, END);
    stop_cheat_caller_address(address);
}

#[test]
#[should_panic(expected: 'BAD_WINDOW')]
fn window_must_end_after_it_starts() {
    let (address, d) = deploy();
    cheat_caller_address(address, OWNER, CheatSpan::TargetCalls(1));
    d.create_proposal('ipfs://bad', END, START);
}

#[test]
fn owner_can_allow_another_proposer() {
    let (address, d) = deploy();
    assert!(!d.is_allowed_proposer(STRANGER), "strangers start disallowed");

    cheat_caller_address(address, OWNER, CheatSpan::TargetCalls(1));
    d.set_allowed_proposer(STRANGER, true);
    assert!(d.is_allowed_proposer(STRANGER));

    cheat_caller_address(address, STRANGER, CheatSpan::TargetCalls(1));
    let id = d.create_proposal('ipfs://from-stranger', START, END);
    assert!(id == 1);
}

#[test]
#[should_panic(expected: 'NOT_OWNER')]
fn only_owner_manages_the_allowlist() {
    let (address, d) = deploy();
    start_cheat_caller_address(address, STRANGER);
    d.set_allowed_proposer(STRANGER, true);
    stop_cheat_caller_address(address);
}

#[test]
fn operator_can_finalize_after_the_window() {
    let (address, d) = deploy();
    let id = create_default_proposal(address, d);

    start_cheat_block_number_global(END + 1);
    let tally = Tally { for_weight: 900, against_weight: 100, abstain_weight: 5 };
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.finalize(id, tally);

    assert!(d.get_proposal(id).finalized, "should be finalized");
    assert!(d.get_tally(id) == tally, "tally should round-trip");
    assert!(d.has_passed(id), "more for than against should pass");
}

#[test]
fn a_losing_proposal_does_not_pass() {
    let (address, d) = deploy();
    let id = create_default_proposal(address, d);

    start_cheat_block_number_global(END + 1);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.finalize(id, Tally { for_weight: 100, against_weight: 900, abstain_weight: 0 });

    assert!(!d.has_passed(id), "fewer for than against must not pass");
}

/// A tie is not a pass. Payouts gate on this, so the boundary matters.
#[test]
fn a_tie_does_not_pass() {
    let (address, d) = deploy();
    let id = create_default_proposal(address, d);

    start_cheat_block_number_global(END + 1);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.finalize(id, Tally { for_weight: 500, against_weight: 500, abstain_weight: 0 });

    assert!(!d.has_passed(id), "a tie must not pass");
}

#[test]
fn an_unfinalized_proposal_has_not_passed() {
    let (address, d) = deploy();
    let id = create_default_proposal(address, d);
    assert!(!d.has_passed(id), "cannot pass before finalizing");
}

#[test]
#[should_panic(expected: 'NOT_TALLY_OPERATOR')]
fn stranger_cannot_finalize() {
    let (address, d) = deploy();
    let id = create_default_proposal(address, d);

    start_cheat_block_number_global(END + 1);
    start_cheat_caller_address(address, STRANGER);
    d.finalize(id, Default::default());
    stop_cheat_caller_address(address);
}

/// Even the owner cannot post a tally — only the operator holding the viewing
/// key is in a position to compute one.
#[test]
#[should_panic(expected: 'NOT_TALLY_OPERATOR')]
fn owner_cannot_finalize() {
    let (address, d) = deploy();
    let id = create_default_proposal(address, d);

    start_cheat_block_number_global(END + 1);
    start_cheat_caller_address(address, OWNER);
    d.finalize(id, Default::default());
    stop_cheat_caller_address(address);
}

#[test]
#[should_panic(expected: 'VOTING_STILL_OPEN')]
fn cannot_finalize_before_the_window_closes() {
    let (address, d) = deploy();
    let id = create_default_proposal(address, d);

    start_cheat_block_number_global(END - 1);
    start_cheat_caller_address(address, OPERATOR);
    d.finalize(id, Default::default());
    stop_cheat_caller_address(address);
}

#[test]
#[should_panic(expected: 'PROPOSAL_NOT_FOUND')]
fn cannot_finalize_a_proposal_that_does_not_exist() {
    let (address, d) = deploy();
    start_cheat_block_number_global(END + 1);
    start_cheat_caller_address(address, OPERATOR);
    d.finalize(999, Default::default());
    stop_cheat_caller_address(address);
}

/// Uses the safe dispatcher because the first finalize must succeed inside the
/// same test before the second one is expected to revert.
#[test]
#[feature("safe_dispatcher")]
fn cannot_finalize_twice() {
    let (address, d) = deploy();
    let id = create_default_proposal(address, d);
    let safe = IProposalRegistrySafeDispatcher { contract_address: address };

    start_cheat_block_number_global(END + 1);
    start_cheat_caller_address(address, OPERATOR);

    safe.finalize(id, Tally { for_weight: 10, against_weight: 1, abstain_weight: 0 }).unwrap();

    match safe.finalize(id, Tally { for_weight: 1, against_weight: 10, abstain_weight: 0 }) {
        Result::Ok(_) => panic!("a second finalize should have reverted"),
        Result::Err(panic_data) => {
            assert!(*panic_data.at(0) == 'ALREADY_FINALIZED');
        },
    }
    stop_cheat_caller_address(address);

    // The original tally must survive the rejected overwrite.
    assert!(d.has_passed(id), "first tally should still stand");
}

#[test]
fn ballot_addresses_are_published_per_choice() {
    let (_, d) = deploy();
    let f = d.ballot_address(1, Choice::For);
    let a = d.ballot_address(1, Choice::Against);
    let b = d.ballot_address(1, Choice::Abstain);

    assert!(f != a && a != b && f != b, "each choice needs its own identity");
    assert!(d.ballot_address(1, Choice::For) == f, "derivation must be stable");
    assert!(d.ballot_address(2, Choice::For) != f, "proposals must not share identities");
}

#[test]
fn proposal_ids_increment() {
    let (address, d) = deploy();
    cheat_caller_address(address, OWNER, CheatSpan::TargetCalls(1));
    let first = d.create_proposal('a', START, END);
    cheat_caller_address(address, OWNER, CheatSpan::TargetCalls(1));
    let second = d.create_proposal('b', START, END);

    assert!(first == 1 && second == 2, "ids should increment");
    assert!(d.proposal_count() == 2);
}
