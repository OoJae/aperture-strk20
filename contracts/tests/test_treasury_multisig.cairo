//! The multisig as the registry's tally operator.
//!
//! The component's own rules are OpenZeppelin's and are tested upstream. What
//! is ours, and what these cover, is the join: that a registry constructed with
//! the multisig's address treats it as the operator, that one signer alone
//! cannot move the treasury, and that a quorum can.

use aperture::proposal_registry::{
    IProposalRegistryDispatcher, IProposalRegistryDispatcherTrait, Tally, TallyProvenance,
};
use openzeppelin_interfaces::multisig::{IMultisigDispatcher, IMultisigDispatcherTrait};
use snforge_std::{
    CheatSpan, ContractClassTrait, DeclareResultTrait, cheat_caller_address, declare,
    start_cheat_block_number_global,
};
use starknet::ContractAddress;
use starknet::account::Call;

const ALICE: ContractAddress = 0x0a11ce.try_into().unwrap();
const BOB: ContractAddress = 0x0b0b.try_into().unwrap();
const CAROL: ContractAddress = 0x0ca401.try_into().unwrap();
const STRANGER: ContractAddress = 0x0bad.try_into().unwrap();

const OWNER: ContractAddress = 0x0111.try_into().unwrap();
const CLASS_HASH: felt252 = 0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f;
const MASTER_PUB: felt252 = 0x1818d42721b097dd91b7495207bc12bd38c73bd66cdb7bcf38c4e41902c1d4b;
const CHAIN_ID: felt252 = 'SN_SEPOLIA';
const EPOCH: felt252 = 'APERTURE:V3:TEST';
const MIN_QUORUM: u128 = 1;
const PAYOUT_TOKEN: ContractAddress = 0x0777.try_into().unwrap();
const PAYOUT_CAP: u128 = 1_000_000;
const START: u64 = 100;
const END: u64 = 200;

/// `announce_payout(proposal_id, commitment_hash, amount)`.
const ANNOUNCE: felt252 = selector!("announce_payout");

fn deploy_multisig(quorum: u32) -> (ContractAddress, IMultisigDispatcher) {
    let contract = declare("TreasuryMultisig").unwrap().contract_class();
    let signers: Array<ContractAddress> = array![ALICE, BOB, CAROL];
    let mut calldata: Array<felt252> = array![];
    quorum.serialize(ref calldata);
    signers.span().serialize(ref calldata);
    let (address, _) = contract.deploy(@calldata).unwrap();
    (address, IMultisigDispatcher { contract_address: address })
}

/// A registry whose tally operator is `operator`, with one passed proposal.
fn deploy_registry(operator: ContractAddress) -> (ContractAddress, IProposalRegistryDispatcher) {
    let contract = declare("ProposalRegistry").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    OWNER.serialize(ref calldata);
    operator.serialize(ref calldata);
    CLASS_HASH.serialize(ref calldata);
    MASTER_PUB.serialize(ref calldata);
    CHAIN_ID.serialize(ref calldata);
    EPOCH.serialize(ref calldata);
    MIN_QUORUM.serialize(ref calldata);
    let timelock: u64 = 0;
    timelock.serialize(ref calldata);
    let (address, _) = contract.deploy(@calldata).unwrap();
    let d = IProposalRegistryDispatcher { contract_address: address };

    start_cheat_block_number_global(START - 1);
    cheat_caller_address(address, OWNER, CheatSpan::TargetCalls(1));
    let id = d.create_proposal('ipfs://p', START, END, MIN_QUORUM, PAYOUT_TOKEN, PAYOUT_CAP);
    assert!(id == 1);

    start_cheat_block_number_global(END + 1);
    cheat_caller_address(address, operator, CheatSpan::TargetCalls(1));
    d
        .finalize(
            1,
            Tally { for_weight: 900, against_weight: 100, abstain_weight: 0 },
            END,
            TallyProvenance::BallotDerived,
            'ballot set commitment',
        );
    (address, d)
}

fn announce_calldata(amount: u128) -> Span<felt252> {
    let mut calldata: Array<felt252> = array![];
    let proposal_id: u64 = 1;
    proposal_id.serialize(ref calldata);
    let commitment: felt252 = 'commitment';
    commitment.serialize(ref calldata);
    amount.serialize(ref calldata);
    calldata.span()
}

#[test]
fn a_quorum_of_signers_can_license_a_payout() {
    let (multisig_address, multisig) = deploy_multisig(2);
    let (registry_address, registry) = deploy_registry(multisig_address);

    let calldata = announce_calldata(500);

    cheat_caller_address(multisig_address, ALICE, CheatSpan::TargetCalls(1));
    let id = multisig.submit_transaction(registry_address, ANNOUNCE, calldata, 0);

    cheat_caller_address(multisig_address, ALICE, CheatSpan::TargetCalls(1));
    multisig.confirm_transaction(id);
    cheat_caller_address(multisig_address, BOB, CheatSpan::TargetCalls(1));
    multisig.confirm_transaction(id);

    cheat_caller_address(multisig_address, ALICE, CheatSpan::TargetCalls(1));
    multisig.execute_transaction(registry_address, ANNOUNCE, calldata, 0);

    // The join: the registry accepted a call whose caller was the multisig.
    assert!(registry.payout_announcement('commitment').amount == 500, "the multisig is the operator");
    assert!(registry.get_authorized(1) == 500, "and the budget was reserved");
}

#[test]
#[should_panic]
fn one_signer_alone_cannot_license_a_payout() {
    // The entire point. Alice submits and confirms, and that is one
    // confirmation against a quorum of two.
    let (multisig_address, multisig) = deploy_multisig(2);
    let (registry_address, _) = deploy_registry(multisig_address);
    let calldata = announce_calldata(500);

    cheat_caller_address(multisig_address, ALICE, CheatSpan::TargetCalls(1));
    let id = multisig.submit_transaction(registry_address, ANNOUNCE, calldata, 0);
    cheat_caller_address(multisig_address, ALICE, CheatSpan::TargetCalls(1));
    multisig.confirm_transaction(id);

    cheat_caller_address(multisig_address, ALICE, CheatSpan::TargetCalls(1));
    multisig.execute_transaction(registry_address, ANNOUNCE, calldata, 0);
}

#[test]
#[should_panic]
fn a_stranger_cannot_submit_a_payout() {
    let (multisig_address, multisig) = deploy_multisig(2);
    let (registry_address, _) = deploy_registry(multisig_address);
    cheat_caller_address(multisig_address, STRANGER, CheatSpan::TargetCalls(1));
    multisig.submit_transaction(registry_address, ANNOUNCE, announce_calldata(500), 0);
}

#[test]
#[should_panic(expected: 'NOT_TALLY_OPERATOR')]
fn a_signer_cannot_bypass_the_multisig_and_call_the_registry_directly() {
    // Being a signer is authority over the multisig, not over the registry.
    // Without this the quorum would be advisory.
    let (multisig_address, _) = deploy_multisig(2);
    let (registry_address, registry) = deploy_registry(multisig_address);
    cheat_caller_address(registry_address, ALICE, CheatSpan::TargetCalls(1));
    registry.announce_payout(1, 'commitment', 500);
}

#[test]
fn the_quorum_is_what_was_asked_for() {
    let (_, multisig) = deploy_multisig(2);
    assert!(multisig.get_quorum() == 2);
    assert!(multisig.is_signer(ALICE) && multisig.is_signer(BOB) && multisig.is_signer(CAROL));
    assert!(!multisig.is_signer(STRANGER));
}
