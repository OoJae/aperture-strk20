# Rubric map

Where to look for each thing the sprint is judged on. Filled in as the work
lands — an empty cell means not built yet, and saying so is the point.

## STRK20 integration depth (30%)

| Signal | Where | Status |
|---|---|---|
| Shielded balances | `apps/web` | Not built |
| Private transfers (ballots, refunds) | `packages/strk20-governance` | Not built |
| Custom `privacy_invoke` anonymizer | `contracts/src/governance_anonymizer.cairo` | Interface only |
| SDK-level note discovery | `services/tally` | Not built |
| Sub-accounts (delegation) | — | Gated on validation |

## Working mainnet product (30%)

| Item | Where | Status |
|---|---|---|
| Verified pool transactions | `strk20.json` | 0 recorded |
| Live demo, no login | — | Not deployed |

## Innovation (25%)

| Claim | Where | Status |
|---|---|---|
| Sealed ballots, invisible mid-vote | `docs/ARCHITECTURE.md` | Designed |
| Treasury payouts that hide the recipient | `docs/TRUST_MODEL.md` | Designed |

## Documentation and open-source quality (15%)

| Item | Where | Status |
|---|---|---|
| MIT license | `LICENSE` | Done |
| Honest privacy accounting | `docs/TRUST_MODEL.md` | Drafted |
| Architecture | `docs/ARCHITECTURE.md` | Drafted |
| Reusable package | `packages/strk20-governance` | Types only |
| CI | `.github/workflows/ci.yml` | Running |
