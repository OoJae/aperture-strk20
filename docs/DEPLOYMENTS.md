# Deployments

## Sepolia

Deployed 2026-08-16 with `sncast`, from `scripts/deploy-sepolia.sh`.

| | Address |
|---|---|
| `ProposalRegistry` | `0x045c7c6d4bbea680dadd7ea248ec793d84ad55f3d381be7c5710b12c900e1cf9` |
| `GovernanceAnonymizer` | `0x00533fedd104a3dd4097a6ad58f9a5637553f1a83f976867866cb60c02d7466d` |
| STRK20 pool (Sepolia) | `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` |

Class hashes: registry `0x05ce106206f1ec3dfefd12dccfc3722b32fe7a0bd77b1c76c8f4947096d5ea1e`,
anonymizer `0x05c37265083181d3669f096b0a594ead9725b75ff4a413dae007c8ddab818a37`.

### What was exercised on-chain

- **Ballot derivation agrees across languages.** The deployed registry returned
  `0x40fccba34a49389e3a9ccd6f11000833df7011d2825753eab823d9afb64e9bc` for FOR on
  proposal 1, byte-identical to what starknet.js computes for the same inputs.
  A voter deriving their destination in the browser lands on exactly the address
  the registry publishes.
- **Proposal lifecycle.** Created proposal 1, finalized it with 900 for / 100
  against / 5 abstain, and read back `has_passed = true` and `finalized = true`.
  Finalizing before the window closes, twice, or from a non-operator all revert.
- **Pool-only access control.** Calling `privacy_invoke` from an ordinary
  account reverts with `CALLER_NOT_POOL`. Only the pool can drive a payout.

### The tally service, exercised against these contracts

The worker in `services/tally` was run against the deployed registry above,
reading from the Sepolia discovery service. It derived all three ballot
identities for a proposal, pinned every read to a settled block ten behind the
head, queried each identity, aggregated the result, and published it with
`finalize()` — transaction
[`0x5a4cf8ac…76899723`](https://sepolia.voyager.online/tx/0x5a4cf8acf50d220416e3a972af4321a63f872571fbdcea4c9a37a9976899723),
`SUCCEEDED`. Reading back afterwards: proposal 2 shows `finalized: true` and a
stored tally.

**The published tally was zero, because no ballots had been cast.** What this
proves is the *submission* path — derivation, discovery, aggregation, and the
on-chain write — not the counting of real votes. Casting a sealed ballot
requires a ballot identity with a registered viewing key, and registration is a
pool transaction needing a proof; see the limits below.

The discovery endpoint is configuration (`INDEXER_URL`), never a constant. No
discovery service has been published for either network, so the operator
chooses one and no such choice is committed here.

### What could not be exercised on Sepolia

The payout register-and-claim path runs *through* the pool: it withdraws to the
anonymizer, invokes it, and pulls back an open note. Driving that needs a proved
pool transaction, and no proving-service endpoint is published for either
network — so the on-chain proof stops at the access-control boundary.

That path is covered by the `snforge` suite instead, which impersonates the pool
and asserts the full lifecycle including the allowance the pool would pull
against. See `docs/ARCHITECTURE.md` for the endpoint situation.

## Mainnet

Contracts are not deployed to mainnet yet. When they are, the existing deployed
account can be adopted with `sncast account import --type ready`, so no new
funding is needed.

Recorded mainnet pool transactions live in `strk20.json`.
