# Probe: are the STRK20 discovery services actually published?

Date: 2026-08-23. Method: unauthenticated HTTPS from a clean shell. No repo
secret was used — the viewing key below is the literal `0x2a`, chosen to prove
the endpoint answers rather than to read any real note.

## /health

    discovery-service.alpha-mainnet.sw-dev.io   200  chain_head 13,747,937  (Starknet mainnet)
    transaction-prover.alpha-mainnet.sw-dev.io  200  {"status":"ok"}
    discovery-service.alpha-sepolia.sw-dev.io   200  chain_head 13,927,984  (Starknet Sepolia)
    transaction-prover.alpha-sepolia.sw-dev.io  200  {"status":"ok"}

A health route proves only that something is listening, so it was not treated as
an answer.

## POST /v1/sync/incoming_state

Request pinned to mainnet block 13,748,043 (`0x346f32a8652685fa…`), pool
`0x0403…812a`, recipient the derived FOR ballot address for proposal 1.

    alpha-mainnet   200
      {"block_ref":"0x346f32a8652685faa51a688d1a22b0c43ed7892342b6e030f4575e2f6d092e0",
       "channels":[],"subchannels":[],"notes":[],
       "cursor":{"channel_discovery_complete":true,"total_n_channels":0}}

    alpha-sepolia   503
      {"error":{"code":"STORAGE_ERROR","message":"Storage backend error"}}

## What this establishes

1. **A mainnet discovery service is published and functional.** It echoed the
   pinned `block_ref` back, which is the behaviour the tally worker depends on
   for a reproducible count. Empty `notes` is the correct answer: no note has
   ever been sent to that address, and the viewing key was a dummy.

2. **The cursor is `ApiDiscoveryCursor`, not `ApiHistoryCursor`.** The live
   response carries `channel_discovery_complete` and `total_n_channels`, and no
   `history_complete` field. `services/tally/src/discovery.ts:120` breaks its
   pagination loop on `page.cursor?.history_complete !== false`, which is
   therefore always true against this server: every scan stops after page one.
   This is confirmed from the deployed service, not inferred from SDK types.

3. **Sepolia's discovery service was returning 503 at the time of the probe**
   while mainnet was healthy — the inverse of what every document in this repo
   asserts.

## What it does not establish

That the mainnet *proving* service works. `/health` says ok; a proof request is
the only real test, and that needs a funded account and the SDK. Until that runs,
"the mainnet lifecycle is reproducible" stays unproven — the discovery half is
answered, the proving half is not.

## Files asserting the opposite, all now wrong for mainnet

`CLAUDE.md:98-106` (fact 9), `docs/ARCHITECTURE.md:85-87`,
`docs/DEPLOYMENTS.md:100-103`, `docs/TRUST_MODEL.md:83-95`,
`services/tally/src/refunds.ts:6-7`, `services/tally/src/config.ts:11-13`,
`services/tally/README.md:19-24`, `.env.example:30-33`.
