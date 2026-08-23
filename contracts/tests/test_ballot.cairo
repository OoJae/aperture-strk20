//! Cross-language checks on ballot-identity derivation.
//!
//! The expected addresses below were produced by starknet.js
//! (`hash.calculateContractAddressFromHash`) — regenerate them with
//! `node scripts/ballot-vectors.ts`. Voters derive their destination in the
//! browser with starknet.js while the registry derives it in Cairo, so the two
//! implementations agreeing is what makes a ballot land where the DAO can read
//! it. A failure here is never cosmetic.

use aperture::ballot::{
    Choice, ballot_address, ballot_domain, ballot_salt, choice_index, compute_address,
};

/// The OpenZeppelin account class, whose constructor takes exactly
/// `[public_key]` — the calldata this derivation hashes. Deriving against a
/// class with a different constructor (Argent's takes `[0, pubkey, 1]`) yields
/// addresses that look fine and correspond to no deployable account.
const CLASS_HASH: felt252 = 0x5b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564;
/// A synthetic domain, so the pinned vectors do not churn every time a registry
/// is redeployed. Real deployments pass their own address.
const TEST_DOMAIN: felt252 = 0x1234;
const MASTER_PUB: felt252 = 0x1818d42721b097dd91b7495207bc12bd38c73bd66cdb7bcf38c4e41902c1d4b;

#[test]
fn compute_address_matches_starknet_js_salt_1() {
    let got = compute_address(1, CLASS_HASH, [MASTER_PUB].span());
    let want: felt252 = 0x710d716fc033396fc946d32e3f9fb4d1fe146038bc148d5b51c28be58199f38;
    assert!(got == want.try_into().unwrap(), "address mismatch for salt=1");
}

#[test]
fn compute_address_matches_starknet_js_salt_42() {
    let got = compute_address(42, CLASS_HASH, [MASTER_PUB].span());
    let want: felt252 = 0x5a4ba5599e869dfc8a7bfc565818b93747f1c9c184e7b911f07519e2bcdadbf;
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
    let f = ballot_salt(TEST_DOMAIN, 7, Choice::For);
    let a = ballot_salt(TEST_DOMAIN, 7, Choice::Against);
    let b = ballot_salt(TEST_DOMAIN, 7, Choice::Abstain);
    assert!(f != a && a != b && f != b, "choices must not share a salt");
}

#[test]
fn each_proposal_gets_its_own_salt() {
    assert!(
        ballot_salt(TEST_DOMAIN, 1, Choice::For) != ballot_salt(TEST_DOMAIN, 2, Choice::For),
        "proposals must not share a salt",
    );
}

/// The whole point of deriving on-chain: two independent calls agree, so a
/// voter can check the front end's arithmetic.
#[test]
fn ballot_address_is_deterministic() {
    let a = ballot_address(TEST_DOMAIN, 3, Choice::For, CLASS_HASH, MASTER_PUB);
    let b = ballot_address(TEST_DOMAIN, 3, Choice::For, CLASS_HASH, MASTER_PUB);
    assert!(a == b, "derivation must be deterministic");
}

#[test]
fn ballot_addresses_differ_across_choices() {
    let f = ballot_address(TEST_DOMAIN, 3, Choice::For, CLASS_HASH, MASTER_PUB);
    let a = ballot_address(TEST_DOMAIN, 3, Choice::Against, CLASS_HASH, MASTER_PUB);
    assert!(f != a, "FOR and AGAINST must be different identities");
}


// --- cross-language vectors, v2 -------------------------------------------
//
// The same numbers are pinned in packages/strk20-governance/tests/ballot.test.ts
// and computed there by an independent implementation. Two implementations
// agreeing on a fixed value is the only thing that makes either trustworthy;
// asserting that three salts merely differ from each other, which is what this
// file used to do, would pass for a derivation that was wrong in both.

#[test]
fn ballot_salt_matches_the_typescript_vector() {
    // v1 pinned compute_address against raw salts and never pinned the Poseidon
    // salt across languages at all.
    assert!(
        ballot_salt(TEST_DOMAIN, 1, Choice::For) ==
            0x41c213dffecbb88cd6e873c6d089ed170e91459ad0e82d073a9a586b983000e,
        "the salt must match the TypeScript implementation",
    );
}

#[test]
fn ballot_address_matches_the_typescript_vector() {
    assert!(
        ballot_address(TEST_DOMAIN, 1, Choice::For, CLASS_HASH, MASTER_PUB) ==
            0x43f352304641b2e5e0d0e3569784bfd1ce16a5f30ff8114d3e4d5cff1d9544d
                .try_into()
                .unwrap(),
        "the end-to-end address must match the TypeScript implementation",
    );
}

#[test]
fn the_domain_separates_chains() {
    // The live failure this fixes: mainnet and Sepolia v1 both published
    // 0x4ec8ba62… for proposal 1 FOR, because the salt bound neither chain nor
    // registry.
    let main = ballot_domain('SN_MAIN', 0x111.try_into().unwrap(), 'E1');
    let sepolia = ballot_domain('SN_SEPOLIA', 0x111.try_into().unwrap(), 'E1');
    assert!(main != sepolia, "two chains must not share a domain");
    assert!(
        ballot_address(main, 1, Choice::For, CLASS_HASH, MASTER_PUB) !=
            ballot_address(sepolia, 1, Choice::For, CLASS_HASH, MASTER_PUB),
        "two chains must not share a ballot address",
    );
}

#[test]
fn the_domain_separates_registries() {
    let a = ballot_domain('SN_MAIN', 0x111.try_into().unwrap(), 'E1');
    let b = ballot_domain('SN_MAIN', 0x222.try_into().unwrap(), 'E1');
    assert!(a != b, "a redeployed registry must not reuse the old addresses");
}

#[test]
fn the_domain_separates_epochs() {
    let a = ballot_domain('SN_MAIN', 0x111.try_into().unwrap(), 'E1');
    let b = ballot_domain('SN_MAIN', 0x111.try_into().unwrap(), 'E2');
    assert!(a != b, "the epoch is the escape hatch when the address cannot change");
}
