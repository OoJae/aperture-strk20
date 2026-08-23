# Tally service

Reads the ballot notes for each choice of a closed proposal, sums them, and
posts **only the aggregate** — plus the block it counted through — to
`ProposalRegistry.finalize()`. Individual ballots never leave this process.

This service holds viewing keys, so it runs server-side or as a local CLI,
never in the browser.

## Keys

Four roles, four variables, deliberately not one secret:

| Variable | Role | Leaves the process? |
|---|---|---|
| `DAO_BALLOT_VIEWING_SEED` | seeds every per-ballot viewing key | no — only its derived children |
| `DAO_BALLOT_ACCOUNT_PRIVATE_KEY` | signs for every ballot identity account | no |
| `TALLY_OPERATOR_VIEWING_KEY` | the operator's own pool viewing key | **yes, to the indexer in cleartext** |
| `VOTER_VIEWING_KEY` | the voter's own pool viewing key, for `cast-vote` | **yes, to the indexer in cleartext** |

These used to be one value doing all four jobs, two of which disclose it. The
loader now warns when two of them coincide rather than refusing — a pool viewing
key belongs to an *account*, not to a job, so when the voter and the operator
are the same account the keys are legitimately equal. Separating them needs a
separate account, not a separate key.

`.env` is read automatically from the repo root; already-set variables win, so an
explicit export or a CI secret overrides it.

## Design notes

Note discovery in the STRK20 SDK is scoped to a single viewing key: one key sees
one identity's inbox, and there is no third-party enumeration API. So the service
scans **one identity at a time** (proposal × choice) and sums that identity's
notes.

Discovery is cursor-based rather than block-ranged. Three things about that are
load-bearing:

- **The cursor's shape decides when to stop.** This endpoint returns
  `channel_discovery_complete` / `channels`, not the `history_complete` of the
  history cursor. Testing for the wrong field is how a scan silently stops at
  page one and reports a plausible, wrong total.
- **It reads received-transfer history, not the unspent-note set.** The obvious
  call returns only unspent notes; for a balance that is right, for a tally it
  would drop any vote whose identity had since moved a note.
- **Every read is pinned to one settled block hash.** Against a moving tag the
  set can shift between pages, and the pin is what lets anyone re-run the count
  and get the same answer.

Notes are filtered by token and by the proposal's window. A note in the wrong
token is not vote weight, and a note that arrives outside the window is not a
ballot for that proposal — the Sepolia result this project once published as
5 STRK counted one that arrived 945 blocks after voting closed.

## Commands

    node src/probe-ballots.ts <id>          # what is in each box right now (read)
    node src/index.ts <id>                  # count (refuses before end_block)
    node src/index.ts <id> --finalize       # count and publish
    node src/cast-vote.ts <id> <choice> <strk>
    node src/register-ballots.ts <id>
    node src/payout-lifecycle.ts <id> <strk>

## Status, 2026-08-23

Runs against **both** networks. This file used to carry a "known blocker" saying
the mainnet indexer and proving-service URLs were unpublished; that was true when
written and is not true now, and it gated the whole SDK route on something that
had already lifted. Endpoints are configuration and none is baked into this
repository.

What genuinely does not work is **refunds** — paying stake back is a private
transfer, and the worker builds the queue and refuses to pretend it can settle
it. See `docs/TRUST_MODEL.md`.
