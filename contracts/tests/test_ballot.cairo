//! Cross-language checks on ballot-identity derivation.
//!
//! The expected addresses below were produced by starknet.js
//! (`hash.calculateContractAddressFromHash`) — regenerate them with
//! `node scripts/ballot-vectors.ts`. Voters derive their destination in the
//! browser with starknet.js while the registry derives it in Cairo, so the two
//! implementations agreeing is what makes a ballot land where the DAO can read
//! it. A failure here is never cosmetic.

use aperture::ballot::{Choice, ballot_address, ballot_salt, choice_index, compute_address};

const CLASS_HASH: felt252 = 0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f;
const MASTER_PUB: felt252 = 0x1818d42721b097dd91b7495207bc12bd38c73bd66cdb7bcf38c4e41902c1d4b;

#[test]
fn compute_address_matches_starknet_js_salt_1() {
    let got = compute_address(1, CLASS_HASH, [MASTER_PUB].span());
    let want: felt252 = 0x42863fe7f65fda4fb4f0d8714d4d9c25fae3899ed7efa8f7ea1b105ff045ff9;
    assert!(got == want.try_into().unwrap(), "address mismatch for salt=1");
}

#[test]
fn compute_address_matches_starknet_js_salt_42() {
    let got = compute_address(42, CLASS_HASH, [MASTER_PUB].span());
    let want: felt252 = 0x13b9ee29be38a989786213b38375ffcbd7316b6eaf8b3d46a78db3f6fcb7385;
    assert!(got == want.try_into().unwrap(), "address mismatch for salt=42");
}

#[test]
fn choices_have_distinct_indices() {
    assert!(choice_index(Choice::For) == 0);
    assert!(choice_index(Choice::Against) == 1);
    assert!(choice_index(Choice::Abstain) == 2);
}

#[test]
fn each_choice_gets_its_own_salt() {
    let f = ballot_salt(7, Choice::For);
    let a = ballot_salt(7, Choice::Against);
    let b = ballot_salt(7, Choice::Abstain);
    assert!(f != a && a != b && f != b, "choices must not share a salt");
}

#[test]
fn each_proposal_gets_its_own_salt() {
    assert!(
        ballot_salt(1, Choice::For) != ballot_salt(2, Choice::For),
        "proposals must not share a salt",
    );
}

/// The whole point of deriving on-chain: two independent calls agree, so a
/// voter can check the front end's arithmetic.
#[test]
fn ballot_address_is_deterministic() {
    let a = ballot_address(3, Choice::For, CLASS_HASH, MASTER_PUB);
    let b = ballot_address(3, Choice::For, CLASS_HASH, MASTER_PUB);
    assert!(a == b, "derivation must be deterministic");
}

#[test]
fn ballot_addresses_differ_across_choices() {
    let f = ballot_address(3, Choice::For, CLASS_HASH, MASTER_PUB);
    let a = ballot_address(3, Choice::Against, CLASS_HASH, MASTER_PUB);
    assert!(f != a, "FOR and AGAINST must be different identities");
}
