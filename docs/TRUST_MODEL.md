# Trust model

Aperture is a privacy tool, so the honest statement of what it does **not** hide
matters as much as what it does. This page is the reference; nothing in the
README or the demo should claim more than what is written here.

Status: v1, describing what is deployed today. This is the reference for what
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

## Trusted in v1

- **The tally operator.** It derives every ballot identity's viewing key from
  the DAO master secret, so it can see individual ballots. It is trusted to
  publish only the aggregate.
- **The discovery service.** The count is only as complete as the indexer the
  operator points at. Reads are pinned to a settled block hash so anyone can
  re-run the same count and compare, but a dishonest or broken indexer could
  under-report. The endpoint is configuration; no default is shipped.
- **The tally operator again, over the treasury.** In v2 it is also the only
  address that can commit a passed proposal's budget to a specific payout, via
  `authorize_payout` on the registry. It cannot exceed the `payout_cap` the
  proposal was created with, and it cannot pay against a proposal that did not
  pass — but within those bounds it chooses the commitment, and the commitment
  is what determines who can claim. So the operator picks the recipient.

  That authority sits there deliberately. The anonymizer is handed value with no
  sender, which is the property the whole design rests on, so it cannot tell the
  DAO's spending from a stranger's. Somebody identifiable has to hold the budget,
  and the alternative is worse: without this, anyone at all could burn a passed
  proposal's cap to zero permanently for the price of two pool fees. See
  `docs/evidence/2026-08-23-cap-burning.md`.
- **Refund honesty** — and see below, because in this version it is worse than a
  trust assumption.

These are real assumptions, not technicalities. A DAO deploying Aperture as it
stands is trusting whoever runs the tally service.

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
the ballots actually cast. Reads are pinned to a settled block hash so a second
party with the same viewing keys can re-run the count and compare, but that
audits the operator against itself rather than against the chain.

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
result follows from the committed ballot set. A credible first step here would
be publishing a commitment to the ballot set alongside the aggregate, so the
claim becomes checkable in principle rather than taken on faith.

## Refunds do not work in this version

The design says staked vote weight is returned after a proposal closes. Today it
is **computed but not paid**. Issuing a refund is a private transfer, which
requires a proof, which requires a proving service — and no proving endpoint has
been published for mainnet or Sepolia.

The worker builds the refund queue and reports exactly what is owed. Asking it
to execute raises an error rather than half-working, because an operator who
cannot pay should learn that immediately, not after telling voters their stake
was returned.

Refunds now execute — 5 STRK has gone back to a voter on each network — so
voting is no longer a one-way stake. What remains is economics rather than
capability: one pool transaction per note at a flat 6 STRK on mainnet means
refunding a small ballot destroys more than it returns, and nothing batches them
yet.

## The v2 path

- Split the viewing key across a threshold set so no single operator sees
  ballots.
- Move refunds into the anonymizer so they are contract-enforced rather than
  operator-promised.
- Publish a commitment to the ballot set with the aggregate, so the tally can be
  checked rather than trusted.
- Add a re-voting or key-rotation mechanism, without which no amount of
  encryption buys coercion resistance.
- Move payout authority off a single operator — a multisig, or a timelock long
  enough for the DAO to see a licence issued before it can be registered. Today
  one key chooses every recipient within the cap.

Built since this list was written, and no longer pending: a quorum floor with a
per-proposal raise (v1's `has_passed` compared for-weight against against-weight
and nothing else, so a single ballot with no turnout unlocked a payout), a
published counted-through block, and a per-proposal payout token and cap.

## Notes on the protocol itself

- Deposits are screened on-chain by a compliance provider on every route into
  the pool. Running your own prover does not bypass it.
- Private transactions are submitted by shared relayers, so the sender address
  on-chain belongs to a relayer rather than to the voter.
