//! Placeholder suite so CI has something real to run from the first commit.
//!
//! Phase 2 replaces this with the actual coverage: pool-only access control on
//! `privacy_invoke`, the payout lifecycle, double-claim rejection, balance-delta
//! accounting, and a fuzzed claim preimage.

use aperture::governance_anonymizer::GovernanceOperation;
use aperture::proposal_registry::Choice;

#[test]
fn governance_operations_are_distinct() {
    assert!(GovernanceOperation::RegisterPayout != GovernanceOperation::Claim);
}

#[test]
fn ballot_choices_are_distinct() {
    assert!(Choice::For != Choice::Against);
    assert!(Choice::Against != Choice::Abstain);
    assert!(Choice::For != Choice::Abstain);
}
