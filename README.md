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
| `ProposalRegistry` (mainnet) | [`0x05fe6b3b…83d0e7c5`](https://voyager.online/contract/0x05fe6b3b4755184eccd1efbcaac3ba647bbaf578a8ff7fbf31602aee83d0e7c5) |
| `GovernanceAnonymizer` (mainnet) | [`0x01d66b83…40df156`](https://voyager.online/contract/0x01d66b83171db42b8c1bfda02d30149a4888a80e7cb6f84da9837943940df156) |
| `TreasuryMultisig` (mainnet) | [`0x05e59931…adecfee8`](https://voyager.online/contract/0x05e59931f2b0ee69617418d5053de782b0b38a5a72e5d414d65e2a67adecfee8) |
| STRK20 pool (mainnet) | [`0x040337b1…6ffe812a`](https://voyager.online/contract/0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a) |

Six treasury payouts have been executed on mainnet through Aperture's own
anonymizer — the pool withdrew to `GovernanceAnonymizer`, called its
`privacy_invoke`, and the contract parked the value against a commitment only a
preimage can open. Hashes are in [`strk20.json`](strk20.json); Sepolia
deployments and their limits are in [`docs/DEPLOYMENTS.md`](docs/DEPLOYMENTS.md).

**14 STRK is permanently locked in the mainnet anonymizer**, and that is stated
here rather than in a footnote because it is the most expensive thing this
project has learned. Two separate mistakes made it permanent: the claim leg
reverted with `NON_ZERO_VALUE`, and each payout preimage was displayed once and
never stored, so even a working claim has nothing to open those commitments
with. The contract has no sweep. Nobody can recover it — not us.

Both causes are now fixed and both fixes were proved by doing the thing. The
revert was a stale note index: discovery and proving share one block parameter,
so a pin chosen before the transaction it depends on reads pre-transaction state,
and the pool rejects the resulting index by naming a storage slot rather than the
staleness. Waiting for the settled pin to pass the register transaction fixed it,
and **payouts have since been claimed end to end on Sepolia and on mainnet** — the first on any
network. Preimages are now written to disk before anything is submitted, since a
run that dies after registering has escrowed value only that preimage can open.
See [`docs/evidence/2026-08-23-claim-leg-diagnosis.md`](docs/evidence/2026-08-23-claim-leg-diagnosis.md).

The complete sealed-vote lifecycle — three ballot identities deployed at the
addresses the registry publishes, their viewing keys registered, a sealed ballot
cast **inside its voting window**, counted, and the aggregate published on-chain
along with the block it was counted through — runs on **Sepolia**, against v2.

Not yet on mainnet. This used to say the reason was an unpublished proving
service; that was true when written and is not true now. Discovery and proving
both work on both networks against configured endpoints. What remains is
deploying v2 there and funding it.

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

**Trusted today.** Three parties, not two. The tally operator holds the viewing
keys, so it can see individual ballots and is trusted to publish only the
aggregate, and that aggregate is not independently verifiable. The discovery
service can under-report, and a tally computed from an incomplete read is wrong
in a way nothing on-chain reveals — it is also handed a viewing key in
cleartext. Refunds execute, but cost a flat pool fee per note, so settling a small ballot
destroys more than it returns even in principle. These are real assumptions, not technicalities.

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
| Cairo contracts | Implemented, <!--cairo-->96<!--/cairo--> `snforge` tests, deployed to mainnet and Sepolia |
| Shared TS package | Implemented, <!--ts-->85<!--/ts--> tests — ballot derivation, viewing keys, aggregation |
| Tally service | Implemented. Discovers notes, aggregates, publishes on-chain. Run against Sepolia |
| Demo dapp | Live on mainnet, no login |
| Mainnet transactions | 22 in [`strk20.json`](strk20.json), 11 through our own contracts |
| Sealed-vote lifecycle | Run end to end on **mainnet and Sepolia** — cast inside the window, counted, finalized with the block it counted through. An earlier Sepolia ballot arrived 945 blocks late and is kept on the record with its correction |
| Claiming a payout | Works on both networks. The mainnet claim is `0x1174d989…` |
| Refunds | Computed, and undeliverable twice over: no prover, and no payee recorded |
| Demo video | Not made |

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

Requires Node 24+, pnpm 11.1.2, Scarb 2.20.0, and Starknet Foundry 0.63.0.

### The GitHub Packages token

`pnpm install` fails on a clean machine without this, and it is the first
command in this section, so read it before running it.

`services/tally` depends on `@starkware-libs/starknet-privacy-sdk`, which is
published to GitHub Packages rather than npm. The committed `.npmrc` routes that
scope there, and GitHub Packages requires a token even for public packages — so
a fresh clone gets a **401**.

```sh
gh auth refresh -h github.com -s read:packages
echo "//npm.pkg.github.com/:_authToken=$(gh auth token)" >> ~/.npmrc
```

The token lives in `~/.npmrc`, never in this repository.

If you only want the contracts, the shared package, and the web app — none of
which need the SDK — skip the token entirely:

```sh
pnpm install --frozen-lockfile --filter '!@aperture/tally'
```

### Then

```sh
pnpm install
pnpm build          # the web export and the shared package
pnpm test           # repo-invariant tests + package tests
pnpm typecheck
pnpm verify         # re-check every manifest hash against mainnet

cd contracts && scarb build && snforge test
```

Copy `.env.example` to `.env` and fill it in before running anything that talks
to a network. It ships with working values for everything that is not a secret,
including the STRK20 discovery and proving endpoints. `.env` is gitignored and
must stay that way.

## From clone to a cast ballot

These steps deploy **your own** contracts, so run them on **Sepolia** — the
faucet is free and a mistake costs nothing. The same sequence has been run on
mainnet against the contracts above; see `docs/DEPLOYMENTS.md` for every hash.

Starknet fees are STRK-denominated, not ETH. Accounts are contracts, so you fund
the counterfactual address *between* `account create` and `account deploy`.

```sh
# 1. An account, funded at https://faucet.starknet.io
sncast account create --name aperture-sepolia --url "$STARKNET_RPC_URL_SEPOLIA_SNCAST"
#    fund the printed address, then:
sncast account deploy --name aperture-sepolia --url "$STARKNET_RPC_URL_SEPOLIA_SNCAST"

# 2. Your own multisig, registry and anonymizer. Idempotent, so a crashed run
#    resumes. Deploys the multisig FIRST, because the registry fixes it as
#    tally_operator at construction and can never be told a different one, and
#    verifies the ballot domain against an independent derivation BEFORE the
#    anonymizer goes out, because its registry pointer is write-once.
#    Writes the three addresses into .env, which is where every step below
#    reads them from.
node scripts/deploy.ts sepolia --wait

# 3. A proposal, its three ballot identities, and their viewing keys.
#    The window is sized in minutes against the chain's measured block time —
#    Sepolia runs about 1.67s/block, and a window that cannot fit one vote is
#    rejected rather than created.
node scripts/create-proposal.ts "ipfs://your-proposal" --lead 12 --span 75 --cap 3
node scripts/deploy-ballot-accounts.ts 1
node services/tally/src/register-ballots.ts 1

# 4. Cast, inside the window. Shields 5 STRK publicly, waits ten blocks for the
#    note to mature, then privately transfers it into the FOR identity.
node services/tally/src/cast-vote.ts 1 for 5

# 5. See what is in each ballot box. A read: no proof, no fee, no transaction.
#    Run it before waiting out a window, not after.
node services/tally/src/probe-ballots.ts 1

# 6. Count, then publish the aggregate and the block it was counted through
node services/tally/src/index.ts 1
node services/tally/src/index.ts 1 --finalize

# 7. Check the published tally against an independent count, including the
#    commitment to the exact set of ballots it counted
node services/tally/src/verify-tally.ts 1

# 8. Give each voter their stake back. A flat pool fee per note, so refunding a
#    small ballot costs more than it returns — it says so and skips unless
#    --force-uneconomic.
node services/tally/src/refund-lifecycle.ts 1

# 9. Return what is left in the ballot identities once the window has closed
node scripts/sweep-ballot-accounts.ts 1
```

`.env` is read from the repo root automatically; an explicit `export` or a CI
secret overrides it.

**If a step hangs rather than failing:** an insufficient shielded balance
surfaces as a timeout, not an error. A pool action that cannot cover its amount
plus the flat fee — 2 STRK on Sepolia, 6 on mainnet, both taken from the
*shielded* balance — hangs in proving or returns `OHTTP request failed (500)`.
Check the shielded balance first. Three days were lost to this once.

## Things that surprise people

Sharp edges worth knowing before you build against the pool:

- `starknet` must be pinned to `^10.4.0`. A bare install resolves to a version
  without the STRK20 API, and it ships on the npm `next` tag.
- Shielding asks for **two wallet confirmations**. The wallet performs the token
  approval as a separate transaction; this is expected, not a double-submit bug.
- **On the SDK route nothing approves for you.** That second confirmation above
  is the wallet doing it internally. Server-side there is no wallet, and the
  pool cannot pull its fee or your deposit without an ERC20 allowance. The
  failure does not look like a missing approval: the proof builds, the
  transaction assembles, and the node refuses it during fee estimation with
  `Insufficient ERC20 allowance` buried inside a dump of the whole transaction,
  proof blob included.
- **A transfer must say where the change goes.** Spending a 9 STRK note to cast
  5 leaves 4, and the compiler will not guess — it raises `Surplus of N found
  for token X but no surplus action found` before anything is built. Use
  `surplusTo`.
- **A pool transaction needs far more than the flat fee in bounds.** Registering
  a viewing key on Sepolia was refused at a 4.88 STRK balance because the node
  wanted ~5.77 STRK of l2 gas as a ceiling. Bounds are a ceiling rather than a
  bill and the transaction settles for a fraction, but an account that cannot
  cover the ceiling never runs.
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
