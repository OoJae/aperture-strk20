# Rubric map

Where to look for each thing the sprint is judged on.

Every status below is checkable, and checking it is the point: transaction
hashes resolve on Voyager, test counts come from `pnpm test` and `snforge test`,
and contract addresses resolve on the network named. Nothing here says "done"
where the artifact does not exist.

This file was frozen at the scaffold commit until 2026-08-23, reporting "Not
built" for three things that were built, "0 recorded" for ten recorded
transactions, and "Not deployed" for a live demo. It argued against the project
for a week — and then drifted the other way, still calling the mainnet
lifecycle, the claim leg, refunds and the published package undone after all
four had shipped. Corrected again on 2026-08-25 against the ledger.

`scripts/tests/claims.test.ts` fails the build on a scaffold-era status claim no
longer true of this project, a hardcoded address under `apps/web/app/`, or a
landing-page count that has drifted from the ledger. It does **not** check the
statuses in this file, which is exactly why they went stale twice.

## STRK20 integration depth (30%)

| Signal | Where | Status |
|---|---|---|
| Shielded balances | `services/tally` | Working. Shield, private transfer and unshield all executed on mainnet. The dapp reads only; it has no shield control and connects no wallet |
| Private transfers as ballots | `services/tally/src/cast-vote.ts` | Working on mainnet and Sepolia. Two mainnet sealed ballots cast inside their windows, counted, finalized |
| Custom `privacy_invoke` anonymizer | `contracts/src/governance_anonymizer.cairo` | Deployed to mainnet and Sepolia. **8 mainnet payouts escrowed through it, 2 of them claimed**, 32 `snforge` tests |
| SDK-level note discovery | `services/tally/src/discovery.ts` | Implemented and run against both networks. A mainnet discovery service exists and answers — see `docs/evidence/2026-08-23-indexer-probe.md` — and the mainnet lifecycle has since been run against it end to end, twice |
| Sub-accounts (delegation) | — | Not built. Reachable only from the SDK route, so it would be server-side; cut from v1 and said so in `docs/ARCHITECTURE.md` |

## Working mainnet product (30%)

| Item | Where | Status |
|---|---|---|
| Verified pool transactions | `strk20.json` | **44 recorded, 44 SUCCEEDED, 19 through our own contracts**, and 35 by the organisers' pool-event rule. The two sets cross rather than nest — a `finalize` is ours and touches no pool; a bare shield touches the pool and is nobody's contract — so 10 satisfy both, and those 10 lead the manifest because only the first ten are ever checked. `pnpm verify` re-checks every one against both rules |
| Live demo, no login wall | https://aperture-strk20.vercel.app | Live. Reads mainnet with no wallet, no account, no connection |
| Contracts on mainnet | `docs/DEPLOYMENTS.md` | 3 live — registry, anonymizer, and the 2-of-3 treasury multisig — plus 4 superseded that earlier transactions ran through. All 7 resolve |
| Sealed-vote lifecycle on mainnet | `docs/DEPLOYMENTS.md` | **Done, twice.** All three ballot identities deployed and registered; a sealed ballot cast inside its window and finalized with `counted_through == end_block` and `BallotDerived`, against v2 and again against v3 |

## Innovation (25%)

| Idea | Where | Status |
|---|---|---|
| Sealed ballots, invisible mid-vote | `contracts/src/ballot.cairo`, `packages/strk20-governance` | Built and exercised on **mainnet and Sepolia**. A ballot is a private transfer into a per-choice identity derived from public inputs, cast inside its voting window and counted through a block the contract pins |
| Ballot addresses a voter can verify | `apps/web/app/components/BallotIdentities.tsx` | Built — and the page is explicit that agreeing on a derivation is not evidence an account exists there, which is the part that was misleading before |
| Treasury payouts that hide the recipient | `contracts/src/governance_anonymizer.cairo` | Built, 10 mainnet executions — 8 escrowed, 2 claimed. The amount is public; only the recipient is hidden, and `docs/TRUST_MODEL.md` says so |
| Claiming a payout | `services/tally/src/payout-lifecycle.ts` | Works on mainnet and Sepolia. The revert was a stale note index, not the contract; the fix waits for the settled pin to pass the register transaction. Afterwards `outstanding` and `unattached` both read zero |

## Documentation and open-source quality (15%)

| Item | Where | Status |
|---|---|---|
| MIT license | `LICENSE` | Done |
| Honest privacy accounting | `docs/TRUST_MODEL.md` | Names every trusted party, including the discovery service and the value we locked up and cannot recover |
| Architecture | `docs/ARCHITECTURE.md` | Written, and corrected where it contradicted the code |
| Reusable package | `packages/strk20-governance` | Implemented, 62 tests. Published to npm as `@oojae/strk20-governance@0.1.1` |
| CI | `.github/workflows/ci.yml` | Cairo build and tests, TypeScript typecheck and tests |
| Claims checked mechanically | `scripts/tests/claims.test.ts` | The build fails on a scaffold-era status claim no longer true, a hardcoded address under `apps/web/app/`, or a landing-page payout or test count that has drifted from the ledger. The status tables above are not covered |

## What is not done

Stated here so a reader does not have to infer it from silence:

- **Refunds below the batch floor.** Batching shipped: one pool transaction per
  ballot identity rather than one per note, proven on Sepolia (`0x3b2f3c43…`) and on
  mainnet (`0x23170c229d…`), two ballots settled for a single flat fee each time. The floor is the number of
  choices holding stake — at most three, never one — because a transaction is
  scoped to one signing account and one viewing key. So a proposal with a single
  ballot still costs 6 STRK on mainnet to return 5, and `--force-uneconomic`
  remains for exactly that case.
- **A provable tally.** v3 publishes a commitment to the ballot set as well as
  the block it counted through, and `verify-tally` reproduces both from an
  independent count. That makes a disagreement locatable, but an operator who
  counts wrong and commits to their wrong set still passes, and only someone
  trusted with the viewing keys can check at all.
- **Distributed custody.** `tally_operator` is a 2-of-3 multisig behind an
  1800-block timelock, and one key genuinely cannot license a payout any more —
  but all three keys belong to this project's maintainer. What exists is the
  machinery for shared custody, not shared custody. A quorum can add real
  co-signers without redeploying.
- **34.5 STRK is permanently locked**, 14 in the v1 mainnet anonymizer and 20.5
  in the v1 Sepolia one — payout preimages displayed once and never stored,
  against contracts with no sweep. Tickets are now written to disk before
  anything is submitted, which is what stops a third.
- **Sub-accounts (delegation).** Reachable only from the SDK route, so it would
  have to live server-side. Cut, and said so in `docs/ARCHITECTURE.md`.
