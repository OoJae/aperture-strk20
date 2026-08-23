# The Sepolia tally counted a ballot cast after voting closed

Date: 2026-08-23. Found by running the tally worker against the live Sepolia
indexer for the first time since it was rewritten. All reads, no fee.

## What the worker says now

Sepolia proposal 1 is the project's headline evidence: a real sealed ballot,
counted, with `for_weight: 5000000000000000000` published on chain. Counting it
again with the current code:

    Counting proposal 1 at block 13603728 (window 13601928-13603728).
      for      0x4ec8ba62…  0 ballot(s)
      against  0x23de5b4b…  0 ballot(s)
      abstain  0x7384eca5…  0 ballot(s)

      FOR      0.0000 STRK
      result   does not pass

Zero, against a published tally of 5 STRK.

## Why

The ballot arrived late. Read straight from the indexer for the FOR identity:

    amount 5 STRK   block_number 13604673
    proposal 1 window: 13601928 .. 13603728

**945 blocks after the window closed.**

The old worker pinned discovery to `head - 10` — whenever it happened to run —
and applied no window filter at all, so a note that arrived at any time counted.
The current worker pins to `end_block` and filters by the window, so it does not.

## Which one is right

The current one. A proposal declares `start_block` and `end_block`; a ballot that
arrives outside them is not a ballot for that proposal. If arrival time does not
constrain the count, then the window constrains nothing at all — an observer
could wait until the result is known and then vote, which is the exact property
sealed-ballot voting exists to prevent.

`docs/DEPLOYMENTS.md` has said, since the run: *"the vote landed just after the
proposal's window closed. The window governs when `finalize` is permitted, not
when notes may arrive, so the count is sound, but a clean rehearsal would cast
inside the window."*

The first half is a fair description of what v1 enforces. The second half —
"the count is sound" — is a judgement, and it is the one this repository should
not have made in its own favour. "Just after" is also doing a lot of work for 945
blocks.

## What follows

1. **v2 binds the window on chain.** `finalize` takes the block it counted
   through and asserts it equals the proposal's `end_block`. That is the only pin
   that includes every in-window ballot and excludes every late one, and it makes
   the valid pin unique per proposal, so anyone can re-run the count against the
   same state and compare. `docs/TRUST_MODEL.md` claims that is possible today;
   nothing currently makes it checkable.

2. **The record gets re-made.** The Phase D Sepolia rehearsal casts inside the
   window, and that becomes the evidence. The 5 STRK result stays in the history
   with this note attached rather than being quietly dropped.

3. **The docs are corrected** rather than left to imply a clean result.

## A note on how this was found

The eleven tests added with the worker all pass, and none of them could have
caught this: they run against a fake indexer serving canned pages, which is the
right harness for the pagination logic and the wrong one for "does the real
world match the assumption". The finding took one free read against the live
service. Both kinds of check earn their place, and the second had been skipped.
