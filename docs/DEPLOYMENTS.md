# Deployments

## Mainnet

Deployed 2026-08-17. **These are the addresses the demo talks to.**

| | Address |
|---|---|
| `ProposalRegistry` | `0x0371e11c7cae61bc2fd5ce6b75153d59746ecf2d88b286be6ebe9c7c001e330c` |
| `GovernanceAnonymizer` | `0x05cc31d13d5901347d009f70f59abacb22b76e84963286004b67bf4644546890` |
| STRK20 pool (mainnet) | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |

Class hashes: registry `0x05ce106206f1ec3dfefd12dccfc3722b32fe7a0bd77b1c76c8f4947096d5ea1e`,
anonymizer `0x05c37265083181d3669f096b0a594ead9725b75ff4a413dae007c8ddab818a37` —
identical to Sepolia's, since a class hash is derived from the code itself.

Verified on-chain after deploying: the anonymizer points at the mainnet pool and
at this registry, and the registry derives ballot address
`0x4ec8ba62…86a0b00` for FOR on proposal 1 — byte-identical to what starknet.js
computes for the same inputs, and a counterfactual address a real
OpenZeppelin account can be deployed at.

Deploying these needed no prover and no indexer; they are ordinary contract
deployments, which is why mainnet was reachable while the proving endpoints
remain unpublished.

## Sepolia

**Superseded.** The Sepolia registry below was constructed with the Argent
account class as its ballot class. Argent's constructor takes `[0, pubkey, 1]`
while the derivation passes `[pubkey]`, so the addresses it publishes are ones
no account can be deployed at. It is kept here as a record of the Phase 2
lifecycle run, not as something to vote against. The mainnet deployment above
uses the OpenZeppelin class and is correct.

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
