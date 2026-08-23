# Anyone could burn a passed proposal's payout budget, permanently

Date: 2026-08-23. Found by the pre-flight adversarial review of v2, run because
mainnet deployment would make the contracts permanent. Never reached any chain:
the Sepolia v2 deploy that carried it was superseded before it was used.

## The finding

`GovernanceAnonymizer.register_payout` escrows value against a commitment and
adds the amount to `spent[proposal_id]`, which is checked against the proposal's
`payout_cap`. `spent` only ever increases — decrementing it on a claim would
turn the cap into a rate limit rather than a budget, which is not what it is
for.

Every gate on that path is satisfiable by a stranger:

| gate | why it does not stop an attacker |
|---|---|
| `caller == pool` | the pool relays **anybody's** private transaction |
| `terms.passed` | a permanent, public fact about the proposal |
| `token == terms.token` | the attacker uses the same token |
| `held >= outstanding + amount` | the attacker escrows **their own** money |

So: register the full remaining cap against your own funds, then claim it
straight back with the preimage you chose. Your money returns to you as an open
note. `spent` stays at the cap.

The DAO's own payout then reverts with `PAYOUT_CAP_EXCEEDED` — for good, because
v2 has no owner, no pause, no sweep and no upgrade. Cost to the attacker: two
pool flat fees, 12 STRK on mainnet, and they keep the principal.

## Why the anonymizer cannot fix this itself

It is handed value with no sender. That is the property it exists to provide,
and it is why the pool route works at all. It cannot distinguish the DAO
spending its budget from a stranger spending it, because from inside there is no
difference to see.

## The fix

The budget moves to the registry, which does know who is calling.

`ProposalRegistry.authorize_payout(proposal_id, commitment_hash, amount)` is
callable only by the tally operator, only against a passed proposal, once per
commitment hash, and only while the running total stays within `payout_cap`.
`register_payout` then requires a licence matching the proposal and the amount.

An extra public transaction per payout, gas only — no pool fee.

### What it does not fix, and why that is fine

The registry does not see the secret either, so a licence pins the amount
**escrowed**, never the amount the commitment **names**. A malformed mint still
produces an entry whose commitment lies about its value. That is the separate
bug fixed in `fa94165`, and `claim()` comparing the stored entry against the
proved preimage remains the guard for it. The two fixes are independent and both
are needed.

### What it costs

An authorisation is a spend whether or not it is ever registered. If the
operator issues a licence and the payout is abandoned, that slice of the budget
is gone for that proposal. Deliberate: the alternative is a revocation path,
which is a second privileged write for the operator to get wrong, on a contract
with no way to correct anything.

### Disclosure

The commitment hash becomes public one transaction earlier than before. It was
already public in `PayoutRegistered`, and the recipient is hidden by the claim
being a private transaction rather than by the hash being secret. No change to
what an observer learns.

## Tests

Thirteen, split across both contracts. On the registry: who may authorise (not
the owner, not a stranger), a proposal that has not passed, a duplicate
commitment, a zero amount, a zero hash, the cap applied to the **sum** of
licences rather than to each one, and budgets kept separate per proposal. On the
anonymizer: an unlicensed registration rejected, a licence that does not stretch
to a larger escrow, a licence that does not travel to another commitment, and —
the property rather than the revert — that a rejected attempt spends no budget
and leaves the DAO's own payout still registerable and claimable.

## How it was found

Not by the test suite. Every one of the 68 tests passed against the vulnerable
code, because they all approached `register_payout` as the DAO. Nothing asked
what the function looks like to someone who is not the DAO — and the answer was
that it looks exactly the same, which is the whole finding.
