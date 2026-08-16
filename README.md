# Aperture

**Sealed-ballot governance and a shielded treasury for DAOs, native to STRK20.**

Built for the STRK20 Private Sprint, August 2026. Day 1 — this repository is
under active construction and nothing is deployed yet. What follows is the
design; the status table below says honestly how much of it exists.

## The problem

On-chain governance leaks everything.

- **Whales signal outcomes before votes close.** A large holder's vote is
  visible the moment it lands, and everyone else votes with that knowledge.
- **Bribery becomes verifiable.** If a vote is public, a buyer can confirm the
  vote they paid for was actually cast.
- **Treasury payouts are doxxed and front-run.** Grant recipients and amounts
  are visible to anyone watching.

STRK20's shielded pool makes it possible to fix these natively on Starknet.

## How Aperture works

A vote is a private transfer. Each proposal derives one receiving identity per
choice, and casting a ballot means privately transferring your shielded vote
weight into the identity for the choice you want. On-chain, an observer sees a
pool transaction and nothing else — not the choice, not the weight, not the
voter.

Double voting is prevented by the pool itself: notes are spent when transferred,
and a spent note cannot vote twice. When the window closes, a tally service sums
each choice's notes and publishes **only the aggregate**. Ballots are refunded
by private transfer.

Treasury payouts run through Aperture's own Cairo anonymizer, so a grant
recipient is paid without the world learning who they are.

## What is private, and what is not

Shielding itself is public: depositing into the pool emits your address, the
token, and the amount. Privacy starts with what happens after. Treasury payouts
hide the recipient but not the amount, because open notes carry plaintext
amounts. And in this version the tally operator holds the viewing key, so it can
see individual ballots and is trusted to publish only the aggregate.

The full accounting, including what a v2 would fix, is in
[docs/TRUST_MODEL.md](docs/TRUST_MODEL.md). It is worth reading before you trust
anything here.

## Status

| Piece | State |
|---|---|
| Repository, license, CI | Done |
| Cairo interfaces | Types only — implementations in progress |
| Tally service | Scaffold |
| Demo dapp | Placeholder |
| Mainnet transactions | None recorded yet |
| Live demo | Not deployed |

## Repository layout

```
contracts/                    Cairo — ProposalRegistry, GovernanceAnonymizer
packages/strk20-governance/   Shared TS package (ballot derivation, helpers)
apps/web/                     Demo dapp
services/tally/               Server-side tally + refund worker
scripts/                      Tooling, including strk20.json recording
docs/                         Architecture, trust model, rubric map
strk20.json                   Transaction manifest
```

## Building

Requires Node 24+, pnpm, Scarb 2.20.0, and Starknet Foundry 0.63.0.

```sh
pnpm install
pnpm typecheck

cd contracts
scarb build
snforge test
```

Copy `.env.example` to `.env` and fill it in before running anything that talks
to a network. `.env` is gitignored and must stay that way.

## Things that surprise people

Working against the STRK20 pool has a few sharp edges worth knowing up front:

- `starknet` must be pinned to `^10.4.0`. A bare install resolves to a version
  without the STRK20 API, and it ships on the npm `next` tag.
- Shielding asks for **two wallet confirmations**. The wallet performs the token
  approval as a separate transaction; this is expected, not a double-submit bug.
- Notes **mature ten blocks** after they are created, so funds you just shielded
  cannot vote immediately.
- Proving a private action takes roughly **half a minute**.

## License

MIT — see [LICENSE](LICENSE).
