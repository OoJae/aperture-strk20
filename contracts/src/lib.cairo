//! Aperture — sealed-ballot governance and a shielded treasury on STRK20.
//!
//! Every module here is implemented and deployed to Starknet mainnet and
//! Sepolia, with an `snforge` suite each.

pub mod ballot;
pub mod governance_anonymizer;
pub mod proposal_registry;
pub mod treasury_multisig;
