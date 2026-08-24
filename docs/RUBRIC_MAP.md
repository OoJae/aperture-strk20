# Rubric map

Where to look for each thing the sprint is judged on.

Every status below is checkable, and checking it is the point: transaction
hashes resolve on Voyager, test counts come from `pnpm test` and `snforge test`,
and contract addresses resolve on the network named. Nothing here says "done"
where the artifact does not exist.

This file was frozen at the scaffold commit until 2026-08-23, reporting "Not
built" for three things that were built, "0 recorded" for ten recorded
transactions, and "Not deployed" for a live demo. It argued against the project
for months. `scripts/tests/claims.test.ts` now fails the build if the counts
here drift from the tree.

## STRK20 integration depth (30%)

| Signal | Where | Status |
|---|---|---|
| Shielded balances | `services/tally`, `apps/web` | Working. Shield, private transfer and unshield all executed on mainnet |
| Private transfers as ballots | `services/tally/src/cast-vote.ts` | Working on Sepolia: one real sealed ballot cast, counted, finalized |
| Custom `privacy_invoke` anonymizer | `contracts/src/governance_anonymizer.cairo` | Deployed to mainnet and Sepolia. **6 mainnet payouts through it**, 16 `snforge` tests |
| SDK-level note discovery | `services/tally/src/discovery.ts` | Implemented and run against Sepolia. A mainnet discovery service exists and answers — see `docs/evidence/2026-08-23-indexer-probe.md` — but the lifecycle has not been run there |
| Sub-accounts (delegation) | — | Not built. Reachable only from the SDK route, so it would be server-side; cut from v1 and said so in `docs/ARCHITECTURE.md` |

## Working mainnet product (30%)

| Item | Where | Status |
|---|---|---|
| Verified pool transactions | `strk20.json` | **10 recorded, 10 SUCCEEDED, 6 through our own contracts.** `pnpm verify` re-checks every one against both rules |
| Live demo, no login wall | https://aperture-strk20.vercel.app | Live. Reads mainnet with no wallet, no account, no connection |
| Contracts on mainnet | `docs/DEPLOYMENTS.md` | 2, both resolving |
| Sealed-vote lifecycle on mainnet | — | **Not done.** No ballot identity is deployed there; the demo says so on the page that would otherwise offer the addresses |

## Innovation (25%)

| Idea | Where | Status |
|---|---|---|
| Sealed ballots, invisible mid-vote | `contracts/src/ballot.cairo`, `packages/strk20-governance` | Built and exercised on **mainnet and Sepolia**. A ballot is a private transfer into a per-choice identity derived from public inputs, cast inside its voting window and counted through a block the contract pins |
| Ballot addresses a voter can verify | `apps/web/app/components/BallotIdentities.tsx` | Built — and the page is explicit that agreeing on a derivation is not evidence an account exists there, which is the part that was misleading before |
| Treasury payouts that hide the recipient | `contracts/src/governance_anonymizer.cairo` | Built, 6 mainnet executions. The amount is public; only the recipient is hidden, and `docs/TRUST_MODEL.md` says so |
| Claiming a payout | `services/tally/src/payout-lifecycle.ts` | Works on mainnet and Sepolia. The revert was a stale note index, not the contract; the fix waits for the settled pin to pass the register transaction. Afterwards `outstanding` and `unattached` both read zero |

## Documentation and open-source quality (15%)

| Item | Where | Status |
|---|---|---|
| MIT license | `LICENSE` | Done |
| Honest privacy accounting | `docs/TRUST_MODEL.md` | Names every trusted party, including the discovery service and the value we locked up and cannot recover |
| Architecture | `docs/ARCHITECTURE.md` | Written, and corrected where it contradicted the code |
| Reusable package | `packages/strk20-governance` | Implemented, 31 tests. Not yet published to npm |
| CI | `.github/workflows/ci.yml` | Cairo build and tests, TypeScript typecheck and tests |
| Claims checked mechanically | `scripts/tests/claims.test.ts` | The build fails if a status line, a count, or an address drifts from fact |

## What is not done

Stated here so a reader does not have to infer it from silence:

- **The demo video.** `strk20.json.demo_video` is empty.
- **The claim leg.** Registering a payout works; opening one has never
  succeeded. 14 STRK is permanently locked as a result.
- **Voting on mainnet.** Sepolia only.
- **Refunds.** Computed, and undeliverable twice over — no prover, and no payee
  recorded.
- **The published package.** Built and tested, not on npm.
