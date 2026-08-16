# Architecture

Status: Phase 0 outline. Expanded as each piece lands.

## The idea

A vote is a private transfer. Each proposal derives one receiving identity per
choice; casting a ballot means privately transferring shielded vote weight into
the identity for the choice you want. An observer sees a pool transaction and
nothing more — not the choice, not the weight, not the voter.

Two properties fall out of this for free:

- **No double voting.** Notes are spent when transferred, and a spent note
  cannot vote again.
- **No mid-vote signalling.** There is no running count to read, so a whale
  cannot move the outcome by revealing a position early.

After the window closes, the tally service sums each choice's notes and posts
only the aggregate on-chain. Ballots are then refunded by private transfer.

## Components

| Piece | Where | Role |
|---|---|---|
| `ProposalRegistry` | `contracts/src/proposal_registry.cairo` | Proposals, windows, finalized aggregate tallies. Public by design. |
| `GovernanceAnonymizer` | `contracts/src/governance_anonymizer.cairo` | Treasury payouts through the pool's `privacy_invoke` entry point. |
| Tally worker | `services/tally` | Holds the viewing key, sums ballot notes, posts the aggregate, issues refunds. |
| Shared package | `packages/strk20-governance` | Ballot-identity derivation and cast/tally/refund helpers. |
| Demo dapp | `apps/web` | Connect, shield, cast a sealed ballot, watch the tally. |

## Protocol constraints that shaped the design

These come from the STRK20 protocol and are not ours to negotiate:

- **One external invoke per pool transaction.** The payout lifecycle cannot be
  chained into a single transaction; each step is its own.
- **Notes mature ten blocks after creation.** Freshly shielded funds cannot vote
  immediately, so the UI shows the wait rather than appearing to hang.
- **Proving takes roughly half a minute.** Every private action needs a real
  progress state.
- **Approve and deposit can never share a transaction.** The pool's entry point
  is reentrancy-guarded against it.
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

For each choice it derives the ballot identity and its viewing key from the DAO
master secret, reads the notes that identity received, and sums them. There is
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

The indexer URL is configuration, never a constant. No discovery endpoint has
been published for either network, so the operator chooses one and no such
choice is baked into this repository.

## Known limits

**Refunds are computed but cannot be executed.** Returning stake is a private
transfer, which needs a proof, which needs a proving service — and none is
published. The worker builds the refund queue and refuses to pretend it can pay
it. See `docs/TRUST_MODEL.md`.

**Delegation is cut from v1.** Sub-accounts were renamed to shadow accounts, no
anonymizer for them is deployed on any network, and the wallet route does not
expose them at all.
