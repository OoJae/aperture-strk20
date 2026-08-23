//! `ProposalRegistry` behaviour.
//!
//! The registry is deliberately public, so most of what is worth testing is
//! access control and the finalize-once discipline: nothing should be able to
//! post a tally early, twice, or without being the tally operator.

use aperture::ballot::Choice;
use aperture::proposal_registry::{
    TallyProvenance,
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
const CHAIN_ID: felt252 = 'SN_SEPOLIA';
const EPOCH: felt252 = 'APERTURE:V2:TEST';
/// Deliberately tiny. A non-zero floor is what the constructor requires; the
/// existing tally fixtures are raw units, and a realistic 5e18 floor would make
/// every one of them fail quorum for reasons unrelated to what they test.
const MIN_QUORUM: u128 = 1;
const PAYOUT_TOKEN: ContractAddress = 0x0777.try_into().unwrap();
const PAYOUT_CAP: u128 = 1_000_000;

fn deploy() -> (ContractAddress, IProposalRegistryDispatcher) {
    let contract = declare("ProposalRegistry").unwrap().contract_class();
    // Built with Serde rather than by hand: a hand-rolled array silently breaks
    // for any multi-felt type.
    let mut calldata: Array<felt252> = array![];
    OWNER.serialize(ref calldata);
    OPERATOR.serialize(ref calldata);
    CLASS_HASH.serialize(ref calldata);
    MASTER_PUB.serialize(ref calldata);
    CHAIN_ID.serialize(ref calldata);
    EPOCH.serialize(ref calldata);
    MIN_QUORUM.serialize(ref calldata);

    let (address, _) = contract.deploy(@calldata).unwrap();
    (address, IProposalRegistryDispatcher { contract_address: address })
}

fn create_default_proposal(address: ContractAddress, d: IProposalRegistryDispatcher) -> u64 {
    // v2 rejects a window that has already closed, so a proposal has to be
    // created before its own start block. snforge's default height is well past
    // START, which is why this cheat is now required rather than incidental.
    start_cheat_block_number_global(START - 1);
    cheat_caller_address(address, OWNER, CheatSpan::TargetCalls(1));
    start_cheat_block_number_global(START - 1);
    d.create_proposal('ipfs://proposal-1', START, END, MIN_QUORUM, PAYOUT_TOKEN, PAYOUT_CAP)
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
    start_cheat_block_number_global(START - 1);
    d.create_proposal('ipfs://nope', START, END, MIN_QUORUM, PAYOUT_TOKEN, PAYOUT_CAP);
    stop_cheat_caller_address(address);
}

#[test]
#[should_panic(expected: 'BAD_WINDOW')]
fn window_must_end_after_it_starts() {
    let (address, d) = deploy();
    cheat_caller_address(address, OWNER, CheatSpan::TargetCalls(1));
    start_cheat_block_number_global(START - 1);
    d.create_proposal('ipfs://bad', END, START, MIN_QUORUM, PAYOUT_TOKEN, PAYOUT_CAP);
}

#[test]
fn owner_can_allow_another_proposer() {
    let (address, d) = deploy();
    assert!(!d.is_allowed_proposer(STRANGER), "strangers start disallowed");

    cheat_caller_address(address, OWNER, CheatSpan::TargetCalls(1));
    d.set_allowed_proposer(STRANGER, true);
    assert!(d.is_allowed_proposer(STRANGER));

    cheat_caller_address(address, STRANGER, CheatSpan::TargetCalls(1));
    start_cheat_block_number_global(START - 1);
    let id = d.create_proposal('ipfs://from-stranger', START, END, MIN_QUORUM, PAYOUT_TOKEN, PAYOUT_CAP);
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
    d.finalize(id, tally, END, TallyProvenance::BallotDerived);

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
    d.finalize(id, Tally { for_weight: 100, against_weight: 900, abstain_weight: 0 }, END, TallyProvenance::BallotDerived);

    assert!(!d.has_passed(id), "fewer for than against must not pass");
}

/// A tie is not a pass. Payouts gate on this, so the boundary matters.
#[test]
fn a_tie_does_not_pass() {
    let (address, d) = deploy();
    let id = create_default_proposal(address, d);

    start_cheat_block_number_global(END + 1);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.finalize(id, Tally { for_weight: 500, against_weight: 500, abstain_weight: 0 }, END, TallyProvenance::BallotDerived);

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
    d.finalize(id, Default::default(), END, TallyProvenance::BallotDerived);
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
    d.finalize(id, Default::default(), END, TallyProvenance::BallotDerived);
    stop_cheat_caller_address(address);
}

#[test]
#[should_panic(expected: 'VOTING_STILL_OPEN')]
fn cannot_finalize_before_the_window_closes() {
    let (address, d) = deploy();
    let id = create_default_proposal(address, d);

    start_cheat_block_number_global(END - 1);
    start_cheat_caller_address(address, OPERATOR);
    d.finalize(id, Default::default(), END, TallyProvenance::BallotDerived);
    stop_cheat_caller_address(address);
}

#[test]
#[should_panic(expected: 'PROPOSAL_NOT_FOUND')]
fn cannot_finalize_a_proposal_that_does_not_exist() {
    let (address, d) = deploy();
    start_cheat_block_number_global(END + 1);
    start_cheat_caller_address(address, OPERATOR);
    d.finalize(999, Default::default(), END, TallyProvenance::BallotDerived);
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

    safe.finalize(id, Tally { for_weight: 10, against_weight: 1, abstain_weight: 0 }, END, TallyProvenance::BallotDerived).unwrap();

    match safe.finalize(id, Tally { for_weight: 1, against_weight: 10, abstain_weight: 0 }, END, TallyProvenance::BallotDerived) {
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
    start_cheat_block_number_global(START - 1);
    let first = d.create_proposal('a', START, END, MIN_QUORUM, PAYOUT_TOKEN, PAYOUT_CAP);
    cheat_caller_address(address, OWNER, CheatSpan::TargetCalls(1));
    start_cheat_block_number_global(START - 1);
    let second = d.create_proposal('b', START, END, MIN_QUORUM, PAYOUT_TOKEN, PAYOUT_CAP);

    assert!(first == 1 && second == 2, "ids should increment");
    assert!(d.proposal_count() == 2);
}


// --- the counted-through pin ---------------------------------------------
//
// A tally's validity depends entirely on which block it counted through, and
// until v2 nothing on chain recorded that. The Sepolia proposal published as
// 5 STRK counted a ballot that arrived 945 blocks after the window closed; the
// contract could not have known. These are the tests that make that
// unpublishable.

fn finalizable(address: ContractAddress, d: IProposalRegistryDispatcher) -> u64 {
    let id = create_default_proposal(address, d);
    start_cheat_block_number_global(END + 1);
    id
}

fn passing() -> Tally {
    Tally { for_weight: 900, against_weight: 100, abstain_weight: 5 }
}

#[test]
fn counted_through_at_the_end_block_succeeds() {
    let (address, d) = deploy();
    let id = finalizable(address, d);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.finalize(id, passing(), END, TallyProvenance::BallotDerived);

    assert!(d.get_counted_through(id) == END, "the pin must round-trip");
    assert!(d.get_provenance(id) == TallyProvenance::BallotDerived);
}

#[test]
#[should_panic(expected: 'COUNTED_THROUGH_MISMATCH')]
fn counted_through_one_block_early_reverts() {
    // Would miss every ballot cast in the window's final block.
    let (address, d) = deploy();
    let id = finalizable(address, d);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.finalize(id, passing(), END - 1, TallyProvenance::BallotDerived);
}

#[test]
#[should_panic(expected: 'COUNTED_THROUGH_MISMATCH')]
fn counted_through_one_block_late_reverts() {
    // The shape of the real failure: a pin past the close counts ballots that
    // arrived after voting ended.
    let (address, d) = deploy();
    let id = finalizable(address, d);
    start_cheat_block_number_global(END + 2);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.finalize(id, passing(), END + 1, TallyProvenance::BallotDerived);
}

#[test]
#[should_panic(expected: 'COUNTED_THROUGH_MISMATCH')]
fn counted_through_zero_reverts() {
    // What a caller that never computed the pin would send.
    let (address, d) = deploy();
    let id = finalizable(address, d);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.finalize(id, passing(), 0, TallyProvenance::BallotDerived);
}

#[test]
#[should_panic(expected: 'PROVENANCE_UNSET')]
fn provenance_is_required_even_with_a_correct_pin() {
    // Proves the second assert is not shadowed by the first.
    let (address, d) = deploy();
    let id = finalizable(address, d);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.finalize(id, passing(), END, TallyProvenance::Unset);
}

#[test]
fn an_unwritten_provenance_slot_reads_unset() {
    // The whole reason Unset is variant 0. If the derived Store ever wrote
    // index+1, every never-finalized proposal would silently read as
    // BallotDerived — the stronger claim, asserted by nobody.
    let (_, d) = deploy();
    assert!(d.get_provenance(4242) == TallyProvenance::Unset);
    assert!(d.get_counted_through(4242) == 0);
}

#[test]
fn an_operator_asserted_tally_is_pinned_the_same_way() {
    // One rule, not two. Provenance records how the number was produced; it
    // does not buy a different pin.
    let (address, d) = deploy();
    let id = finalizable(address, d);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.finalize(id, passing(), END, TallyProvenance::OperatorAsserted);

    assert!(d.get_provenance(id) == TallyProvenance::OperatorAsserted);
    assert!(d.has_passed(id), "provenance does not change the pass rule");
}

// --- quorum ---------------------------------------------------------------

#[test]
fn turnout_below_quorum_does_not_pass() {
    let (address, d) = deploy();
    start_cheat_block_number_global(START - 1);
    cheat_caller_address(address, OWNER, CheatSpan::TargetCalls(1));
    let id = d.create_proposal('ipfs://high-bar', START, END, 5_000, PAYOUT_TOKEN, PAYOUT_CAP);

    start_cheat_block_number_global(END + 1);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    // Overwhelmingly for, and still short of the bar.
    d.finalize(
        id,
        Tally { for_weight: 900, against_weight: 100, abstain_weight: 0 },
        END,
        TallyProvenance::BallotDerived,
    );
    assert!(!d.has_passed(id), "1000 turnout must not clear a 5000 quorum");
}

#[test]
fn turnout_exactly_at_quorum_passes() {
    let (address, d) = deploy();
    start_cheat_block_number_global(START - 1);
    cheat_caller_address(address, OWNER, CheatSpan::TargetCalls(1));
    let id = d.create_proposal('ipfs://exact', START, END, 1_005, PAYOUT_TOKEN, PAYOUT_CAP);

    start_cheat_block_number_global(END + 1);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.finalize(id, passing(), END, TallyProvenance::BallotDerived);
    assert!(d.has_passed(id), "turnout at the boundary must clear it");
}

#[test]
fn abstain_counts_toward_turnout() {
    // A staked abstain is participation. Excluding it would let a quorum fail
    // on ballots that were cast.
    let (address, d) = deploy();
    start_cheat_block_number_global(START - 1);
    cheat_caller_address(address, OWNER, CheatSpan::TargetCalls(1));
    let id = d.create_proposal('ipfs://abstain', START, END, 1_005, PAYOUT_TOKEN, PAYOUT_CAP);

    start_cheat_block_number_global(END + 1);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.finalize(id, passing(), END, TallyProvenance::BallotDerived);
    // 900 + 100 = 1000, short. The 5 abstain is what clears it.
    assert!(d.has_passed(id));
}

#[test]
#[should_panic(expected: 'QUORUM_BELOW_FLOOR')]
fn a_proposal_cannot_lower_the_floor() {
    let (address, d) = deploy();
    start_cheat_block_number_global(START - 1);
    cheat_caller_address(address, OWNER, CheatSpan::TargetCalls(1));
    d.create_proposal('ipfs://too-low', START, END, MIN_QUORUM - 1, PAYOUT_TOKEN, PAYOUT_CAP);
}

#[test]
fn three_maximal_weights_do_not_panic() {
    // v1 would have overflowed computing turnout in u128. This view is called
    // by the anonymizer inside a pool transaction, where a panic reverts
    // everything with an error naming nothing.
    let (address, d) = deploy();
    let id = finalizable(address, d);
    let max: u128 = 0xffffffffffffffffffffffffffffffff;
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.finalize(
        id,
        Tally { for_weight: max, against_weight: max, abstain_weight: max },
        END,
        TallyProvenance::BallotDerived,
    );
    assert!(!d.has_passed(id), "for == against is not a pass");
}
