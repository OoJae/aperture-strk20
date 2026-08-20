# Aperture

**Sealed-ballot governance and a shielded treasury for DAOs, native to STRK20.**

Live on Starknet mainnet: **https://aperture-strk20.vercel.app**

A vote is a private transfer. Casting a ballot means privately moving shielded
weight into the receiving identity for the choice you want, so an observer sees
a pool transaction and nothing else — not the choice, not the weight, not the
voter. When the window closes, only the aggregate is published.

Built for the STRK20 Private Sprint, August 2026.

## Deployed

| | Address |
|---|---|
| `ProposalRegistry` (mainnet) | [`0x0371e11c…001e330c`](https://voyager.online/contract/0x0371e11c7cae61bc2fd5ce6b75153d59746ecf2d88b286be6ebe9c7c001e330c) |
| `GovernanceAnonymizer` (mainnet) | [`0x05cc31d1…44546890`](https://voyager.online/contract/0x05cc31d13d5901347d009f70f59abacb22b76e84963286004b67bf4644546890) |
| STRK20 pool (mainnet) | [`0x040337b1…6ffe812a`](https://voyager.online/contract/0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a) |

A treasury payout has been executed on mainnet through Aperture's own
anonymizer — the pool withdrew to `GovernanceAnonymizer`, called its
`privacy_invoke`, and the contract parked the value against a commitment only a
preimage can open. Hashes are in [`strk20.json`](strk20.json); Sepolia
deployments and their limits are in [`docs/DEPLOYMENTS.md`](docs/DEPLOYMENTS.md).

The complete sealed-vote lifecycle — three ballot identities registered, a real
sealed ballot cast, tallied, and the aggregate published on-chain — runs on
**Sepolia**. It is not yet reproduced on mainnet, because standing up a ballot
identity there needs a proving service that has not been published.

## The problem

On-chain governance leaks.

- **Whales signal outcomes before votes close.** A large holder's vote is
  visible the moment it lands, and everyone else votes with that knowledge.
- **Vote buying is cheap to police.** When ballots are public, a buyer can
  confirm at a glance that the vote they paid for was cast — no cooperation
  from the seller required.
- **Treasury payouts are doxxed and front-run.** Grant recipients and amounts
  are visible to anyone watching.

Aperture removes the first and third outright, and raises the cost of the
second. What it does *not* do is covered honestly below.

## How it works

Each proposal derives one receiving identity per choice, from public inputs, so
a voter can verify the destination rather than trust the interface — the demo
shows that comparison live. Casting a ballot is a private transfer into the
identity for your choice.

Double voting is prevented by the pool itself: notes are spent when transferred,
and a spent note cannot vote twice. A tally service holds the ballot identities'
viewing keys, reads what each received, and publishes only the aggregate.

Treasury payouts run through Aperture's own Cairo anonymizer implementing
`privacy_invoke`, so a grant recipient is paid without the world learning who
they are.

## What is private, and what is not

Overclaiming privacy is worse than not having it.

**Private.** Which choice you voted for, the weight behind it, the link between
you and your choice, and who receives a treasury payout.

**Public.** Shielding itself — depositing into the pool emits your address, the
token, and the amount. Proposal metadata and voting windows. The final aggregate
tally. The *amount* of a treasury payout, because open notes carry plaintext
amounts; a payout hides who, not how much.

**On vote buying, precisely.** Aperture removes the *free, public, at-scale*
verifiability of votes, which is what makes trustless bribery markets work. It
does **not** give receipt-freeness. A voter who wants to prove how they voted
still can, by revealing their viewing key: the ballot address is a public label
of the choice, so a briber can confirm it against this repository's own
contract. Defeating a willing seller needs a mechanism this design does not have
— see [`docs/TRUST_MODEL.md`](docs/TRUST_MODEL.md) for what that would take.

**Trusted today.** The tally operator holds the viewing keys, so it can see
individual ballots and is trusted to publish only the aggregate, and that
aggregate is not independently verifiable. Refunds are computed but cannot be
executed. Both are real assumptions, not technicalities.

The full accounting is in [`docs/TRUST_MODEL.md`](docs/TRUST_MODEL.md). It is
worth reading before trusting anything here.

## Known limitations

Named rather than hidden:

- **No quorum.** `has_passed` compares for-weight against against-weight and
  nothing else, so a single ballot with no turnout passes a proposal. The
  constructor sets the anonymizer's registry immutably, so adding quorum means
  redeploying both contracts; it is v2 scope rather than a patch.
- **Proposal metadata is one felt** (~31 bytes), which cannot hold an IPFS URI.
- **No delegation, ranked choice, timelocks, or generic execution.** Aperture is
  a privacy mechanism for governance, not a complete governance stack.

## Status

| Piece | State |
|---|---|
| Cairo contracts | Implemented, 39 `snforge` tests, deployed to mainnet and Sepolia |
| Shared TS package | Implemented, 31 tests — ballot derivation, viewing keys, aggregation |
| Tally service | Working; reads the live indexer, aggregates, publishes on-chain |
| Demo dapp | Live on mainnet, no login |
| Mainnet transactions | Recorded in [`strk20.json`](strk20.json) |
| Sealed-vote lifecycle | Proven end to end on Sepolia |
| Refunds | Computed, not executable |

## Repository layout

```
contracts/                    Cairo — ProposalRegistry, GovernanceAnonymizer
packages/strk20-governance/   Shared TS package (ballot derivation, helpers)
apps/web/                     Demo dapp
services/tally/               Server-side tally + refund worker
scripts/                      Tooling, including strk20.json recording
docs/                         Architecture, trust model, deployments
strk20.json                   Transaction manifest
```

## Building

Requires Node 24+, pnpm, Scarb 2.20.0, and Starknet Foundry 0.63.0.

```sh
pnpm install
pnpm typecheck
pnpm test

cd contracts
scarb build
snforge test
```

Copy `.env.example` to `.env` and fill it in before running anything that talks
to a network. `.env` is gitignored and must stay that way.

## Things that surprise people

Sharp edges worth knowing before you build against the pool:

- `starknet` must be pinned to `^10.4.0`. A bare install resolves to a version
  without the STRK20 API, and it ships on the npm `next` tag.
- Shielding asks for **two wallet confirmations**. The wallet performs the token
  approval as a separate transaction; this is expected, not a double-submit bug.
- Notes **mature ten blocks** after they are created, so funds you just shielded
  cannot vote immediately.
- Proving a private action takes roughly **half a minute**.
- The Wallet API rejects any felt with a **leading zero** after `0x`, and
  Starknet addresses are conventionally written zero-padded. Normalise them or
  the whole request fails with `INVALID_REQUEST_PAYLOAD` and no clue which field
  was wrong.
- The pool charges a **flat fee per transaction**, taken from your *shielded*
  balance rather than your wallet — 6 STRK on mainnet, 2 on Sepolia.
- **Insufficient shielded balance surfaces as a timeout, not an error.** A pool
  action that cannot cover its amount plus the flat fee hangs in proving, or
  returns `OHTTP request failed (500)`, rather than saying what is wrong. Three
  days were lost here to theories about proving relays and note discovery; the
  answer was simply to shield more. Check the shielded balance first.

## License

MIT — see [LICENSE](LICENSE).
