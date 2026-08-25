# Architecture

Status, 2026-08-25. **v3 runs on mainnet, end to end; Sepolia runs v2.** On mainnet and on
Sepolia: a sealed ballot cast inside its voting window, counted, and finalized
against the block the contract demands, and a treasury payout registered and
claimed. v1 is superseded on both and holds 34.5 STRK nobody can recover.

Where this document and the code disagree, the code is right and this document
is a bug. Several statements here were exactly that until 2026-08-23; the
corrections are noted where they mattered.

## The idea

A vote is a private transfer. Each proposal derives one receiving identity per
choice; casting a ballot means privately transferring shielded vote weight into
the identity for the choice you want. An observer sees a pool transaction and
nothing more — not the choice, not the weight, not the voter.

Two properties fall out of this for free:

- **A note cannot be spent twice.** Notes are consumed when transferred, so the
  same weight cannot be cast twice. This is narrower than "no double voting":
  nothing stops one person shielding more funds and casting again, because
  nothing here knows that two notes belong to one person. Vote weight is by
  stake, not by head.
- **No mid-vote signalling.** There is no running count to read, so a whale
  cannot move the outcome by revealing a position early.

After the window closes, the tally service sums each choice's notes and posts
only the aggregate on-chain, along with the block it counted through.

Refunding the stake afterwards is the design, and it does not work — see **Known
limits**. This paragraph used to end "Ballots are then refunded by private
transfer", stated as fact, two sections above the section saying it was
impossible.

## Components

| Piece | Where | Role |
|---|---|---|
| `ProposalRegistry` | `contracts/src/proposal_registry.cairo` | Proposals, windows, finalized aggregate tallies. Public by design. |
| `GovernanceAnonymizer` | `contracts/src/governance_anonymizer.cairo` | Treasury payouts through the pool's `privacy_invoke` entry point. |
| Tally worker | `services/tally` | Holds the ballot viewing keys, sums ballot notes, posts the aggregate. Computes refunds; cannot pay them. |
| Shared package | `packages/strk20-governance` | Ballot-identity derivation and cast/tally/refund helpers. |
| Demo dapp | `apps/web` | Reads proposals, ballot identities and tallies with no wallet at all; connects a wallet only for the treasury-payout path. **Casting a ballot is not in the browser** — it is `services/tally/src/cast-vote.ts`. |

## Protocol constraints that shaped the design

These come from the STRK20 protocol and are not ours to negotiate:

- **One external invoke per pool transaction.** The payout lifecycle cannot be
  chained into a single transaction; each step is its own.
- **Notes mature ten blocks after creation.** Freshly shielded funds cannot vote
  immediately, so the UI shows the wait rather than appearing to hang.
- **Proving takes roughly half a minute.** Every private action needs a real
  progress state.
- **Approve and deposit are separate transactions on the SDK route.** The pool
  pulls its flat fee, and the deposit amount, from the sender's ERC20 allowance,
  and nothing on this route grants it for you. The wallet route looks like one
  action because the wallet approves internally — that is the "one action, two
  confirmations" in the project's notes, not two transactions the user sends.
  Getting this wrong does not read as a missing approval: the proof builds, the
  transaction assembles, and the node refuses it during fee estimation with
  `Insufficient ERC20 allowance` buried inside a dump of the whole transaction.
- **Note discovery is scoped to one viewing key.** There is no third-party
  enumeration, so the tally worker runs one client per ballot identity.

## Two routes into the pool

Aperture uses both, deliberately.

- **Wallet route** — the browser dapp. The user's wallet holds the keys and
  performs shielding and ballot transfers. No viewing key ever reaches the
  frontend.
- **SDK route** — the tally worker. Holds its own keys server-side, and is the
  only route that can reach note discovery and sub-accounts.

## How the tally works

Counting is a **read**, and that is what makes it possible. Discovery needs an
*indexer*; the heavyweight prover in the STRK20 stack is only needed to write.
So the worker never runs one.

For each choice it derives the ballot identity from `DAO_MASTER_PUBLIC_KEY` and
its viewing key from `DAO_BALLOT_VIEWING_SEED`, reads the notes that identity
received, and sums them.

Those are two different keys on purpose. There used to be one master secret
doing four jobs — seeding every ballot viewing key, signing for every ballot
account, and acting as the pool viewing key on two separate paths — and two of
those jobs hand the value to a third-party indexer in cleartext. One scalar with
that blast radius is not a key. This document said "the DAO master secret" long
after the split. There is
no batch discovery API — one viewing key sees one identity's inbox — so it fans
out one read per choice and aggregates the results.

Two details are load-bearing rather than incidental:

- It reads **received-transfer history**, not the unspent-note set. The obvious
  call, `discoverNotes`, returns only unspent notes and silently omits spent
  ones. For a balance that is right; for a tally it would mean a ballot identity
  that ever moved a note had that vote quietly vanish from the count.
- Every read is **pinned to one settled block hash**, ten blocks behind the
  head. Against a moving tag the set can shift between pages. Pinning also gives
  reorg detection for free, since a hash that has been reorged out stops
  resolving. Anyone can re-run the count against the same hash and get the same
  answer.

Aggregation itself is a pure function in `packages/strk20-governance`, separate
from anything that touches the network, and deduplicates by note id — paginated
reads can legitimately return a note twice, and double-counting a vote would be
silent.

The indexer URL is configuration, never a constant, and no endpoint is baked
into this repository.

This section used to say no discovery endpoint had been published for either
network, which is what the project's own notes claimed and what it believed
until it was tested. It is wrong: discovery works on **both** networks against a
configured endpoint, and every count and probe in this repository now runs
against a live one. The claim gated the whole SDK route on a blocker that had
already lifted.

## Known limits

**Refunds work, and cost more than they return.** A refund is a private transfer
back to the note's sender, and the worker pays them. But a pool transaction is a
flat 6 STRK on mainnet, so settling a 5 STRK ballot destroys more value than it
returns — printed per entry, and skipped unless `--force-uneconomic`. Batching a
proposal's refunds into one pool transaction is the fix and is not built. See
`docs/TRUST_MODEL.md`.

**Delegation is cut from v1.** Sub-accounts were renamed to shadow accounts, no
anonymizer for them is deployed on any network, and the wallet route does not
expose them at all.

## Two things v2 added that the flow above does not show

**A payout must be licensed before it can be funded.** `register_payout` on the
anonymizer is reachable by anyone — it is called through the pool, which relays
anybody's private transaction, and the anonymizer is handed value with no sender.
So the budget lives on the registry: `authorize_payout` is tally-operator-only
and bounded by the proposal's `payout_cap`, and the anonymizer refuses any
registration it has no matching licence for. Without it, a stranger could burn a
passed proposal's entire cap to zero permanently for the price of two pool fees.
See `docs/evidence/2026-08-23-cap-burning.md`.

**`finalize` publishes the block it counted through**, and asserts it equals the
proposal's `end_block`. A tally's validity depends entirely on the block it was
pinned to — the same ballot box counted through two different blocks gives two
different answers — and v1 published no pin at all. This makes the valid pin
unique per proposal, so a second party can re-run the count against the same
state and compare. It does not make the sum provable; it makes the claim
checkable, which it was not before.
