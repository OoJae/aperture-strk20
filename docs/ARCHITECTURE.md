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

## Known blocker, and what we are doing about it

No indexer/discovery or proving-service endpoint has been published for
**either** network — not mainnet, not Sepolia. The SDK ships
`IndexerDiscoveryProvider` but not the contract-based alternative, so note
discovery currently has nothing to talk to.

This does not stop the product. The wallet route performs its own proving and
discovery, so shielding, ballots, and refunds all work from the browser today.
What it gates is the **tally worker**, which is the one component that must read
notes it does not own a wallet for.

Tallying is read-only, and that matters: it needs an *indexer*, not a prover.
The heavyweight machine in the STRK20 stack is the prover, and we never need to
run one. So, in preference order:

1. **Self-host the discovery service.** It is open source in the protocol
   monorepo and read-only, which keeps our deepest integration intact.
2. **Run the tally as a CLI and show it honestly on video** if hosting proves
   awkward mid-sprint.
3. **Reimplement contract-based discovery** against raw RPC using the viewing
   key — walking channels, subchannels, and notes ourselves. This is what the
   unexported provider would have done. It is the most interesting option and
   the riskiest; stretch only.

**Delegation is cut from v1.** Sub-accounts are reachable only from the SDK
route, and the SDK route is gated on the same missing endpoints.
