# Trust model

Aperture is a privacy tool, so the honest statement of what it does **not** hide
matters as much as what it does. This page is the reference; nothing in the
README or the demo should claim more than what is written here.

Status: v3 on mainnet and v2 on Sepolia, describing what is deployed today. This is the reference for what
Aperture claims; the README and the demo must not claim more than it does.

## Private

- Ballot choice, and the weight behind it.
- The link between a voter and the choice they voted for.
- The recipient of a treasury payout.
- Internal treasury balances.

## Public

- That an address interacted with the STRK20 pool, and when.
- **Shielding itself.** Depositing into the pool emits an event carrying the
  depositor's address, the token, and the amount. Privacy begins with what
  happens *after* the deposit, not with the deposit.
- Proposal metadata, voting windows, and the final aggregate tally.
- **The amount of a treasury payout claimed as an open note.** Open notes carry
  plaintext amounts. A payout hides *who* was paid, not *how much*.

## Trusted in v3

- **The tally operator.** It derives every ballot identity's viewing key from
  the DAO master secret, so it can see individual ballots. It is trusted to
  publish only the aggregate.
- **The discovery service.** The count is only as complete as the indexer the
  operator points at. Reads are pinned to the proposal's own closing block, so a
  second party holding the same viewing keys can re-run the count and compare —
  not "anyone", since counting means discovering the notes each ballot identity
  received, which needs that identity's viewing key. A dishonest or broken
  indexer could still under-report. The endpoint is configuration rather than a
  constant, and `.env.example` ships the public STRK20 discovery services as
  defaults so a fresh clone works; point it elsewhere by setting it.
- **The tally operator again, over the treasury.** It is still the only address
  that can commit a passed proposal's budget to a specific payout, via
  `announce_payout` and then `authorize_payout` on the registry. Under v3 that
  address is a 2-of-3 `TreasuryMultisig` and the two legs are separated by an
  1800-block timelock, so a single key cannot license a payout and nothing can be
  licensed without the DAO having had roughly an hour to watch it happen. That
  narrows the assumption; it does not remove it, and all three keys currently
  belong to this project's maintainer. It cannot exceed the `payout_cap` the
  proposal was created with, and it cannot pay against a proposal that did not
  pass — but within those bounds it chooses the commitment, and the commitment
  is what determines who can claim. So the operator picks the recipient.

  That authority sits there deliberately. The anonymizer is handed value with no
  sender, which is the property the whole design rests on, so it cannot tell the
  DAO's spending from a stranger's. Somebody identifiable has to hold the budget,
  and the alternative is worse: without this, anyone at all could burn a passed
  proposal's cap to zero permanently for the price of two pool fees. See
  `docs/evidence/2026-08-23-cap-burning.md`.
- **Refund honesty.** Refunds are operator-run private transfers rather than
  contract-enforced escrow, so the operator is trusted to send them. See below:
  they now execute, which makes this a trust assumption rather than a gap.

These are real assumptions, not technicalities. A DAO deploying Aperture as it
stands is trusting whoever runs the tally service.

## Value we locked up and cannot recover

**34.5 STRK is permanently locked**, and it belongs here rather than in a
footnote because it is the most expensive thing this project has done.

- **14 STRK** in the v1 mainnet anonymizer.
- **20.5 STRK** in the v1 Sepolia one.

Both are the same failure, made twice: a payout preimage was displayed once and
never stored, against a contract with no sweep. The commitment can only be
opened by its preimage, so the value is not stolen or stuck pending — it is
unreachable by anyone, including us, forever.

What changed: tickets are now written to disk before anything is submitted, so a
run that dies after registering can still open what it escrowed. That is what
stops a third.

## Aperture is not receipt-free

This is the sharpest limit in the design, and the one most easily mistaken for
something stronger.

Ballot secrecy means an observer cannot tell how you voted. Aperture has that.
**Receipt-freeness** means you cannot prove how you voted *even if you want to*.
Aperture does not have it, and is in one respect worse than a generic shielded
transfer: `ballot_address(proposal_id, choice)` is a public view on our own
registry, so the destination address is a canonical public label of the choice.
A voter who reveals their viewing key hands a briber a receipt the briber can
check against this repository's own contract, in seconds, without our
cooperation. In a system like Zcash the recipient is a semantics-free
pseudonym; here it encodes the vote.

There is also nothing to lie with. A voter cannot re-vote, rotate a key, or
produce a plausible false receipt, so a coercer who demands proof gets a real
one.

What Aperture genuinely removes is the *free, public, at-scale* verifiability
that makes trustless bribery markets work: nobody can scrape outcomes, and a
buyer must transact with each seller individually and trust what they are shown.
That is a real increase in cost. It is not coercion resistance, and the README
does not claim it is.

Closing this properly needs a mechanism this design lacks — MACI's key-change
trick, where a voter can invalidate an earlier ballot so any receipt they hand
over might already be void, is the best-known approach.

## The tally is not verifiable

The operator publishes an aggregate and nothing proves it is the correct sum of
the ballots actually cast. Reads are pinned to the proposal's own closing block,
so a second party with the same viewing keys can re-run the count and compare —
but that audits the operator against itself rather than against the chain.

Until v2 that claim was weaker than it sounded, because **nothing published
which block the count was pinned to.** A tally's validity depends entirely on
that block — the same ballot box counted through two different blocks gives two
different answers, and this repository has an instance of exactly that: the
Sepolia proposal published as 5 STRK counted a ballot that arrived 945 blocks
after the window closed, and the current worker scores it zero. v2's `finalize`
takes the counted-through block and asserts it equals the proposal's `end_block`,
so the pin is both published and unique per proposal. That does not make the sum
provable; it makes the claim checkable, which it was not before.

Systems that solve this — Helios, Belenios, MACI — publish either a homomorphic
tally with a proof of correct decryption, or a ZK proof that the published
result follows from the committed ballot set. The credible first step named here
has been taken: v3's `finalize` publishes a commitment to the ballot set
alongside the aggregate, and `verify-tally` recomputes it from an independent
count. That makes a disagreement locatable rather than merely suspected. It does
not make the sum provable — an operator who counts wrong and commits to their
wrong set still passes, and only someone trusted with the viewing keys can check
at all.

## Refunds work, and cost more than they return

The design says staked vote weight is returned after a proposal closes, and it
is. A refund is a private transfer proved through the configured proving service;
the worker builds the queue, reports exactly what is owed, and
`services/tally/src/refund-lifecycle.ts` pays it, writing a receipt before it
submits so a retry cannot double-pay.

This section used to say refunds were computed but not paid, because no proving
endpoint had been published. That was true when written and is not true now.

Refunds execute, and they are batched: one pool transaction per ballot identity,
settling every note that identity holds. Not one per proposal — a pool
transaction is scoped to one signing account and one viewing key, and `for`,
`against` and `abstain` keep their stakes at different addresses, so the floor is
the number of choices that received stake. At most three. Proven on both
networks: `0x3b2f3c43…` on Sepolia and `0x23170c229d…` on mainnet, two ballots each,
one transaction each, and the count re-run afterwards unchanged.

Proven on Sepolia on 2026-09-01: two ballots at one identity, returned in the
single transaction `0x3b2f3c43…`, one flat fee instead of two. Re-running
`verify-tally` afterwards returned the same totals and the same ballot-set
commitment, which is the property that makes refunding safe at all — discovery
reads received-transfer history, not the unspent set, so spending a ballot note
cannot move the count.

What remains is the floor itself. A single ballot is still one transaction, so a
lone 5 STRK vote on mainnet costs 6 STRK to return; `--force-uneconomic` exists
for that case and no longer for the ordinary one.

## Still ahead

- Split the viewing key across a threshold set so no single operator sees
  ballots.
- Move refunds into the anonymizer so they are contract-enforced rather than
  operator-promised.
- Add a re-voting or key-rotation mechanism, without which no amount of
  encryption buys coercion resistance.

Built since this list was written, and no longer pending: a quorum floor with a
per-proposal raise (v1's `has_passed` compared for-weight against against-weight
and nothing else, so a single ballot with no turnout unlocked a payout), a
published counted-through block, a per-proposal payout token and cap, a
published commitment to the ballot set that `verify-tally` reproduces from an
independent count, and payout authority moved off a single key — the
`tally_operator` is a 2-of-3 `TreasuryMultisig` behind an 1800-block timelock.
That last one is machinery rather than distributed trust while all three keys
are the maintainer's; a quorum can add real co-signers without redeploying.

## Notes on the protocol itself

- Deposits are screened on-chain by a compliance provider on every route into
  the pool. Running your own prover does not bypass it.
- Private transactions are submitted by shared relayers, so the sender address
  on-chain belongs to a relayer rather than to the voter.
