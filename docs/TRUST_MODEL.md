# Trust model

Aperture is a privacy tool, so the honest statement of what it does **not** hide
matters as much as what it does. This page is the reference; nothing in the
README or the demo should claim more than what is written here.

Status: v1 design, written Phase 0. Updated as the implementation lands.

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

- **The tally operator.** It holds the DAO viewing key, so it can see individual
  ballots. It is trusted to publish only the aggregate.
- **Refund honesty.** After a proposal closes, the operator returns the staked
  vote weight through private transfers. Nothing on-chain forces it to.

Both are real trust assumptions, not technicalities. A DAO deploying Aperture as
it stands is trusting whoever runs the tally service.

## The v2 path

- Split the viewing key across a threshold set so no single operator sees
  ballots.
- Move refunds into the anonymizer so they are contract-enforced rather than
  operator-promised.

## Notes on the protocol itself

- Deposits are screened on-chain by a compliance provider on every route into
  the pool. Running your own prover does not bypass it.
- Private transactions are submitted by shared relayers, so the sender address
  on-chain belongs to a relayer rather than to the voter.
