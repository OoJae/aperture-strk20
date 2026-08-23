# Why the claim leg reverts with NON_ZERO_VALUE

Date: 2026-08-23. Sepolia. **Every probe below is a read — no proof, no fee, no
transaction.** That matters: the previous three attempts at this spent pool fees
and learned less, because `payout-lifecycle.ts` has no try/catch around
submission and discards the revert trace.

## The error was being read backwards

Cairo names the *bad state*, not the requirement. Aperture's own contract does
it: `assert(amount.is_non_zero(), errors::ZERO_AMOUNT)` — the constant names what
must not happen. The pool follows the same convention, so

    NON_ZERO_VALUE  ==  assert(slot == 0) failed

means **something required to be empty was occupied**. It does not mean "this
transaction must move value", which is how it was read for three days and which
sent the investigation after a nominal withdrawal that was never the problem.

The pool has exactly four `WriteOnce` sites — public key, channel marker,
nullifier, and note. Only one of them is reachable from a claim.

## The mechanism, established in five steps

**1. A note id has no entropy in it.** From the SDK's own hashes module:

    compute_note_id(channel_key, token, index) = poseidon("NOTE_ID_TAG:V1", channel_key, token, index, 0)

No block, no salt, no randomness. The `random`/`salt` fields on
`CreateOpenNoteInput` encrypt the *amount*; they do not vary the slot. Two
transactions agreeing on `(channel_key, token, index)` write the same slot, and
the second one panics.

**2. Our channel key, derived offline, matches what the indexer reports.**

    compute_channel_key(operator, viewingKey, operator, registeredPublicKey)
      -> 0x5f42ab63f8751fd1…

The indexer's cursor independently returned `"channel_key":
"0x5f42ab63f8751fd1ec7d87bd07d46c5801e99948d603290501b852c1583508a"`. Two
independent derivations agreeing is what makes the rest of this trustworthy.

**3. Slots 0–5 are occupied; the first free index is 6.** Read directly from the
pool with `get_note`:

    index   packed_value   state
        0   non-zero       OCCUPIED
        …
        5   non-zero       OCCUPIED
        6   0              free

The indexer agrees from the other direction: `last_note_index: 5,
total_n_notes: 6`.

**4. The index the SDK uses depends on which block it asks about.** This is the
step that turns a plausible story into a demonstrated one. Querying
`/v1/sync/outgoing_state` for the same account at different `block_ref`s:

    head-1000000   last_note_index = none     (no channel yet)
    head-600000    last_note_index = none
    head-300000    last_note_index = 0
    head-100000    last_note_index = 5
    head-10        last_note_index = 5

`noteNonce = last_note_index + 1`, so a pin behind a note's creation yields an
index that has already been written.

**5. The SDK forwards the proving block into discovery.** `ExecuteOptions` has
one block field, `provingBlockId`, and the compiler passes it to both
`discoverChannels` and `discoverNotes`. There is no separate discovery-block
option. `payout-lifecycle.ts` computes `settledBlock()` — `head - 10` — *once per
leg*. The claim leg runs seconds after the register transaction lands, so its
`head - 10` still points before it.

## Putting it together

1. The register leg's surplus compiles to `CreateEncNote` at index `N`, and the
   pool writes note slot `compute_note_id(channelKey, token, N)`. It lands at
   block `B`.
2. The claim leg recomputes `head' - 10`, and since `head'` is only a block or
   two past `B`, that pin is **before** `B`.
3. The indexer, asked about that block, reports the pre-register
   `last_note_index`, so `noteNonce` comes back as `N`.
4. The claim's `transfer({ amount: Open })` compiles to `CreateOpenNote` at index
   `N` — the same slot.
5. `WriteOnce` finds it non-zero and panics `NON_ZERO_VALUE`.

This also explains why the register leg has never failed: it is always the first
writer of the pair, so its slot is always empty. And why this cannot happen to a
real claimant: they are a different address with a different channel key. **The
bug exists only in the single-account demo shape, which is exactly the shape that
was being tested.**

## Two hypotheses killed on the way

- **"The transaction must move value."** Demoted then discarded. The error name
  reads the other way, and the Cairo claim path does move value — the pool pulls
  `transfer_from` after the invoke. The supporting evidence was a *wallet's*
  payload validator, not the pool.
- **"The pool blocks our contract as an open-note depositor."**
  `is_open_note_depositor_blocked(anonymizer)` returns `false`. Worth checking
  first, because nothing on our side could have fixed it.

And one earlier conclusion corrected: commit `7a00939` recorded that adding
`surplusTo` to the claim leg "makes the pool reject the note as non-empty". That
experiment was a no-op — `resolveNotes` returns early without `surpluses` or
`autoSelectNotes`, so the compiled action list was byte-identical with and
without it. The observation was real; the attribution was not.

## The fix, and what it took to find the right one

Two attempts, and the first one being wrong is the useful part.

**Attempt 1 — thread the registry.** `ExecuteResult.registry` is advanced
optimistically at compile time, so passing it into the claim leg supplies the
next index without asking an indexer. This required also dropping
`autoDiscover: { channels: "refresh" }`, because `createPool` installs discovered
channels first and then skips registry channels for any address discovery
already covered — a stale re-read silently overrides the registry.

Result: **`NON_ZERO_VALUE` disappeared** and `INDEX_NOT_SEQUENTIAL` appeared in
its place. The collision was gone; the index was now *past* what the pool would
accept. That is a better error, and it confirmed the diagnosis — the failure was
always about which index, never about moving value.

**Attempt 2 — wait for the pin, then read normally.** The index is not something
to reconstruct client-side. It comes from the chain, and the only real problem
was reading a block that predated the transaction it depended on. So: after the
register transaction lands, block until `head - MATURITY_BLOCKS` has caught up
past its block, then let discovery run exactly as it always did.

```
1. Registering the payout (pool -> our anonymizer)
   0x6f0841aba54ef71bc0ae19933f7734444869b3a8ff674798d7814a8774d357d
   waiting: pin 13931175 is still behind block 13931184 (9 to go)…
   pin 13931184 is past block 13931184; safe to read.
2. Claiming the payout (preimage -> open note credited back)
   0x5c45f69a47fb666bfb7aa3082752324b40719f1a91a1882efa872e3516f69cc
```

## The result

**A payout was claimed. This had never succeeded on any network.** Verified on
chain rather than taken from the script's own output:

    register  SUCCEEDED  block 13931184  pool events 4  anonymizer events 1
    claim     SUCCEEDED  block 13931202  pool events 3  anonymizer events 1

    get_payout(0x641ca747cc2b95f0…)
      amount   0.50 STRK
      proposal 1
      claimed  TRUE

The commitment is opened, the escrowed value was credited back through an open
note, and both legs ran through `GovernanceAnonymizer`.

## No Cairo change is required

This mattered for sequencing: v2 is a one-shot deploy, so a claim-side contract
bug had to be ruled out before the contracts were written. It is ruled out. The
Cairo claim path — recompute the commitment from the secret, mark it claimed
before any external call, measure the balance, approve the pool — was correct
throughout. The bug was entirely in how the client chose a block.

## One more thing this cost

The failed attempt registered a payout and then died before printing its
preimage, so **0.5 STRK on Sepolia is now permanently unclaimable** — the same
way 14 STRK was lost on mainnet, for the same reason, during the investigation
into why that happens. The preimage must be persisted before the register
transaction is submitted, not after the claim succeeds. `TreasuryPayout.tsx`
already does this; `payout-lifecycle.ts` does not, and should.
