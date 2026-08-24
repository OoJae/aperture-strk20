//! `ProposalRegistry` behaviour.
//!
//! The registry is deliberately public, so most of what is worth testing is
//! access control and the finalize-once discipline: nothing should be able to
//! post a tally early, twice, or without being the tally operator.

use aperture::ballot::Choice;
use aperture::proposal_registry::{
    IProposalRegistryDispatcher, IProposalRegistryDispatcherTrait, IProposalRegistrySafeDispatcher,
    IProposalRegistrySafeDispatcherTrait, Tally, TallyProvenance,
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
/// Zero for every test that is not about the timelock, so a confirmation does
/// not have to wait for blocks it does not care about.
const TIMELOCK: u64 = 0;
const PAYOUT_TOKEN: ContractAddress = 0x0777.try_into().unwrap();
const PAYOUT_CAP: u128 = 1_000_000;

fn deploy() -> (ContractAddress, IProposalRegistryDispatcher) {
    deploy_with_timelock(TIMELOCK)
}

fn deploy_with_timelock(timelock: u64) -> (ContractAddress, IProposalRegistryDispatcher) {
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
    timelock.serialize(ref calldata);

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
    let id = d
        .create_proposal('ipfs://from-stranger', START, END, MIN_QUORUM, PAYOUT_TOKEN, PAYOUT_CAP);
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
    d.finalize(id, tally, END, TallyProvenance::BallotDerived, 'ballot set commitment');

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
    d
        .finalize(
            id,
            Tally { for_weight: 100, against_weight: 900, abstain_weight: 0 },
            END,
            TallyProvenance::BallotDerived,
            'ballot set commitment',
        );

    assert!(!d.has_passed(id), "fewer for than against must not pass");
}

/// A tie is not a pass. Payouts gate on this, so the boundary matters.
#[test]
fn a_tie_does_not_pass() {
    let (address, d) = deploy();
    let id = create_default_proposal(address, d);

    start_cheat_block_number_global(END + 1);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d
        .finalize(
            id,
            Tally { for_weight: 500, against_weight: 500, abstain_weight: 0 },
            END,
            TallyProvenance::BallotDerived,
            'ballot set commitment',
        );

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
    d
        .finalize(
            id, Default::default(), END, TallyProvenance::BallotDerived, 'ballot set commitment',
        );
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
    d
        .finalize(
            id, Default::default(), END, TallyProvenance::BallotDerived, 'ballot set commitment',
        );
    stop_cheat_caller_address(address);
}

#[test]
#[should_panic(expected: 'VOTING_STILL_OPEN')]
fn cannot_finalize_before_the_window_closes() {
    let (address, d) = deploy();
    let id = create_default_proposal(address, d);

    start_cheat_block_number_global(END - 1);
    start_cheat_caller_address(address, OPERATOR);
    d
        .finalize(
            id, Default::default(), END, TallyProvenance::BallotDerived, 'ballot set commitment',
        );
    stop_cheat_caller_address(address);
}

#[test]
#[should_panic(expected: 'PROPOSAL_NOT_FOUND')]
fn cannot_finalize_a_proposal_that_does_not_exist() {
    let (address, d) = deploy();
    start_cheat_block_number_global(END + 1);
    start_cheat_caller_address(address, OPERATOR);
    d
        .finalize(
            999, Default::default(), END, TallyProvenance::BallotDerived, 'ballot set commitment',
        );
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

    safe
        .finalize(
            id,
            Tally { for_weight: 10, against_weight: 1, abstain_weight: 0 },
            END,
            TallyProvenance::BallotDerived,
            'ballot set commitment',
        )
        .unwrap();

    match safe
        .finalize(
            id,
            Tally { for_weight: 1, against_weight: 10, abstain_weight: 0 },
            END,
            TallyProvenance::BallotDerived,
            'ballot set commitment',
        ) {
        Result::Ok(_) => panic!("a second finalize should have reverted"),
        Result::Err(panic_data) => { assert!(*panic_data.at(0) == 'ALREADY_FINALIZED'); },
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
    d.finalize(id, passing(), END, TallyProvenance::BallotDerived, 'ballot set commitment');

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
    d.finalize(id, passing(), END - 1, TallyProvenance::BallotDerived, 'ballot set commitment');
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
    d.finalize(id, passing(), END + 1, TallyProvenance::BallotDerived, 'ballot set commitment');
}

#[test]
#[should_panic(expected: 'COUNTED_THROUGH_MISMATCH')]
fn counted_through_zero_reverts() {
    // What a caller that never computed the pin would send.
    let (address, d) = deploy();
    let id = finalizable(address, d);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.finalize(id, passing(), 0, TallyProvenance::BallotDerived, 'ballot set commitment');
}

#[test]
#[should_panic(expected: 'PROVENANCE_UNSET')]
fn provenance_is_required_even_with_a_correct_pin() {
    // Proves the second assert is not shadowed by the first.
    let (address, d) = deploy();
    let id = finalizable(address, d);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.finalize(id, passing(), END, TallyProvenance::Unset, 'ballot set commitment');
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
    d.finalize(id, passing(), END, TallyProvenance::OperatorAsserted, 'ballot set commitment');

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
    d
        .finalize(
            id,
            Tally { for_weight: 900, against_weight: 100, abstain_weight: 0 },
            END,
            TallyProvenance::BallotDerived,
            'ballot set commitment',
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
    d.finalize(id, passing(), END, TallyProvenance::BallotDerived, 'ballot set commitment');
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
    d.finalize(id, passing(), END, TallyProvenance::BallotDerived, 'ballot set commitment');
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
    d
        .finalize(
            id,
            Tally { for_weight: max, against_weight: max, abstain_weight: max },
            END,
            TallyProvenance::BallotDerived,
            'ballot set commitment',
        );
    assert!(!d.has_passed(id), "for == against is not a pass");
}

// --- payout authorisation -------------------------------------------------
//
// The budget is spent here rather than in the anonymizer, because this is the
// only one of the two that knows who is spending it. The anonymizer is reached
// through the pool, which relays anybody's private transaction, and it is
// handed value with no sender — that is the property it exists to provide. So
// without a licence issued here, a stranger could escrow their own money
// against a passed proposal, claim it straight back, and leave `spent` sitting
// at the cap with every later payout failing for good.

fn pass_a_proposal(address: ContractAddress, d: IProposalRegistryDispatcher) -> u64 {
    let id = create_default_proposal(address, d);
    start_cheat_block_number_global(END + 1);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d
        .finalize(
            id,
            Tally { for_weight: 900, against_weight: 100, abstain_weight: 0 },
            END,
            TallyProvenance::BallotDerived,
            'ballot set commitment',
        );
    id
}

#[test]
fn the_operator_can_commit_budget_to_a_payout() {
    let (address, d) = deploy();
    let id = pass_a_proposal(address, d);

    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.announce_payout(id, 'commitment', 500);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.authorize_payout('commitment');

    let auth = d.payout_authorization('commitment');
    assert!(auth.proposal_id == id && auth.amount == 500, "licence should round-trip");
    assert!(d.get_authorized(id) == 500);
    // An unwritten slot must read as no licence, not as a licence for nothing.
    assert!(d.payout_authorization('never issued').amount == 0);
}

#[test]
#[should_panic(expected: 'NOT_TALLY_OPERATOR')]
fn a_stranger_cannot_commit_the_daos_budget() {
    let (address, d) = deploy();
    let id = pass_a_proposal(address, d);
    cheat_caller_address(address, STRANGER, CheatSpan::TargetCalls(1));
    d.announce_payout(id, 'commitment', 500);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.authorize_payout('commitment');
}

#[test]
#[should_panic(expected: 'NOT_TALLY_OPERATOR')]
fn even_the_owner_cannot_commit_the_daos_budget() {
    // Same split as `finalize`: the owner administers the registry, the
    // operator moves value. Neither borrows the other's authority.
    let (address, d) = deploy();
    let id = pass_a_proposal(address, d);
    cheat_caller_address(address, OWNER, CheatSpan::TargetCalls(1));
    d.announce_payout(id, 'commitment', 500);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.authorize_payout('commitment');
}

#[test]
#[should_panic(expected: 'PROPOSAL_NOT_PASSED')]
fn budget_cannot_be_committed_before_the_vote_passes() {
    let (address, d) = deploy();
    let id = create_default_proposal(address, d);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.announce_payout(id, 'commitment', 500);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.authorize_payout('commitment');
}

#[test]
#[should_panic(expected: 'ANNOUNCEMENT_EXISTS')]
fn one_commitment_cannot_be_announced_twice() {
    // Otherwise the same hash could be re-announced indefinitely and the running
    // total would reserve its budget every time while the anonymizer honoured it
    // once. The budget is reserved at announcement, so this is where the guard
    // has to be.
    let (address, d) = deploy();
    let id = pass_a_proposal(address, d);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.announce_payout(id, 'commitment', 500);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.announce_payout(id, 'commitment', 500);
}

#[test]
#[should_panic(expected: 'AUTHORIZATION_EXISTS')]
fn one_commitment_cannot_be_licensed_twice() {
    let (address, d) = deploy();
    let id = pass_a_proposal(address, d);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.announce_payout(id, 'commitment', 500);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.authorize_payout('commitment');
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.authorize_payout('commitment');
}

#[test]
#[should_panic(expected: 'NOT_ANNOUNCED')]
fn a_payout_cannot_be_licensed_without_being_announced() {
    // The timelock is only a delay if there is no way round it. Confirming a
    // commitment nobody announced would be exactly that.
    let (address, d) = deploy();
    let _ = pass_a_proposal(address, d);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.authorize_payout('never announced');
}

#[test]
#[should_panic(expected: 'NOT_TALLY_OPERATOR')]
fn a_stranger_cannot_announce_a_payout() {
    let (address, d) = deploy();
    let id = pass_a_proposal(address, d);
    cheat_caller_address(address, STRANGER, CheatSpan::TargetCalls(1));
    d.announce_payout(id, 'commitment', 500);
}

#[test]
#[should_panic(expected: 'NOT_TALLY_OPERATOR')]
fn a_stranger_cannot_confirm_someone_elses_announcement() {
    // Announcing in public must not mean anyone can act on it.
    let (address, d) = deploy();
    let id = pass_a_proposal(address, d);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.announce_payout(id, 'commitment', 500);
    cheat_caller_address(address, STRANGER, CheatSpan::TargetCalls(1));
    d.authorize_payout('commitment');
}

#[test]
fn an_announcement_grants_nothing_until_it_is_confirmed() {
    // The property the anonymizer depends on: it reads payout_authorization and
    // treats a non-zero amount as permission. An announcement sharing that view
    // would be permission the moment it was made.
    let (address, d) = deploy();
    let id = pass_a_proposal(address, d);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.announce_payout(id, 'commitment', 500);

    assert!(d.payout_authorization('commitment').amount == 0, "announcing must grant nothing");
    assert!(d.payout_announcement('commitment').amount == 500, "but it must be recorded");
    // Budget is reserved at announcement, so the cap cannot be double-spent by
    // announcing twice and confirming both.
    assert!(d.get_authorized(id) == 500, "announcing reserves the budget");

    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.authorize_payout('commitment');
    assert!(d.payout_authorization('commitment').amount == 500, "confirming grants it");
    assert!(d.get_authorized(id) == 500, "confirming must not reserve it a second time");
}

#[test]
#[should_panic(expected: 'PAYOUT_CAP_EXCEEDED')]
fn the_cap_bounds_the_sum_of_every_licence() {
    // Not each one individually — two licences that each fit must still fail
    // together once they exceed the cap.
    let (address, d) = deploy();
    let id = pass_a_proposal(address, d);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.announce_payout(id, 'first', PAYOUT_CAP);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.authorize_payout('first');
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.announce_payout(id, 'second', 1);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.authorize_payout('second');
}

#[test]
#[should_panic(expected: 'ZERO_PAYOUT_AMOUNT')]
fn a_licence_for_nothing_is_rejected() {
    let (address, d) = deploy();
    let id = pass_a_proposal(address, d);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.announce_payout(id, 'commitment', 0);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.authorize_payout('commitment');
}

#[test]
#[should_panic(expected: 'ZERO_COMMITMENT_HASH')]
fn a_licence_naming_no_commitment_is_rejected() {
    let (address, d) = deploy();
    let id = pass_a_proposal(address, d);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.announce_payout(id, 0, 500);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.authorize_payout(0);
}

#[test]
fn each_proposal_carries_its_own_budget() {
    let (address, d) = deploy();
    let first = pass_a_proposal(address, d);

    // A second proposal, passed on its own window.
    start_cheat_block_number_global(START - 1);
    cheat_caller_address(address, OWNER, CheatSpan::TargetCalls(1));
    let second = d
        .create_proposal('ipfs://proposal-2', START, END, MIN_QUORUM, PAYOUT_TOKEN, PAYOUT_CAP);
    start_cheat_block_number_global(END + 1);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d
        .finalize(
            second,
            Tally { for_weight: 900, against_weight: 100, abstain_weight: 0 },
            END,
            TallyProvenance::BallotDerived,
            'ballot set commitment',
        );

    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.announce_payout(first, 'a', PAYOUT_CAP);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.authorize_payout('a');
    // The first proposal's budget is fully committed; the second's is untouched.
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.announce_payout(second, 'b', PAYOUT_CAP);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.authorize_payout('b');

    assert!(d.get_authorized(first) == PAYOUT_CAP);
    assert!(d.get_authorized(second) == PAYOUT_CAP);
}


// --- the timelock ---------------------------------------------------------
//
// The operator is the only address that can license a payout, and it chooses
// the commitment, so it chooses the recipient. The cap bounds how much; nothing
// bounded how suddenly. These are the tests for the delay.

#[test]
#[should_panic(expected: 'TIMELOCK_NOT_ELAPSED')]
fn a_payout_cannot_be_licensed_one_block_early() {
    let (address, d) = deploy_with_timelock(50);
    let id = pass_a_proposal(address, d);

    start_cheat_block_number_global(END + 1);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.announce_payout(id, 'commitment', 500);

    // One block short of announced_at + 50.
    start_cheat_block_number_global(END + 50);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.authorize_payout('commitment');
}

#[test]
fn a_payout_can_be_licensed_the_moment_the_delay_elapses() {
    // The boundary, from the other side: exactly announced_at + timelock is
    // enough. An off-by-one here would make the lock one block longer than the
    // constant says, which is the kind of thing nobody notices until it matters.
    let (address, d) = deploy_with_timelock(50);
    let id = pass_a_proposal(address, d);

    start_cheat_block_number_global(END + 1);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.announce_payout(id, 'commitment', 500);
    assert!(d.payout_announcement('commitment').announced_at == END + 1);

    start_cheat_block_number_global(END + 51);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.authorize_payout('commitment');
    assert!(d.payout_authorization('commitment').amount == 500);
}

#[test]
fn a_zero_timelock_is_legal_and_means_no_delay() {
    // Sepolia deploys with zero so a rehearsal is not gated on wall-clock time.
    // Legal, and it should behave as no delay rather than as an error.
    let (address, d) = deploy_with_timelock(0);
    let id = pass_a_proposal(address, d);
    assert!(d.payout_timelock_blocks() == 0);

    start_cheat_block_number_global(END + 1);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.announce_payout(id, 'commitment', 500);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.authorize_payout('commitment');
    assert!(d.payout_authorization('commitment').amount == 500);
}

// --- the ballot-set commitment --------------------------------------------

#[test]
#[should_panic(expected: 'ZERO_BALLOT_COMMITMENT')]
fn a_tally_cannot_be_published_without_committing_to_its_ballots() {
    // Required rather than optional, so a missing commitment cannot be mistaken
    // for a proposal that predates the idea.
    let (address, d) = deploy();
    let id = create_default_proposal(address, d);
    start_cheat_block_number_global(END + 1);
    cheat_caller_address(address, OPERATOR, CheatSpan::TargetCalls(1));
    d.finalize(id, passing(), END, TallyProvenance::BallotDerived, 0);
}

#[test]
fn the_ballot_commitment_is_published_with_the_tally() {
    let (address, d) = deploy();
    let id = pass_a_proposal(address, d);
    assert!(d.get_ballot_commitment(id) == 'ballot set commitment');
    // Zero for a proposal that was never finalized, which is unambiguous
    // because finalize rejects zero.
    assert!(d.get_ballot_commitment(999) == 0);
}
