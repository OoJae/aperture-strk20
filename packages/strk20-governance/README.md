# @oojae/strk20-governance

Sealed-ballot governance primitives for the [STRK20 shielded pool](https://strk20-by-example.org)
on Starknet.

A vote is a private transfer. Each proposal derives one receiving identity per
choice, and casting a ballot means privately transferring shielded vote weight
into the identity for the choice you want. An observer sees a pool transaction
and nothing else — not the choice, not the weight, not the voter — and there is
no running count to read mid-vote.

This package is the part both sides need to agree on: the address derivation, so
a voter and the contract compute the same destination, and the aggregation, so a
tally can be reproduced by anyone who can read the notes.

```sh
npm install @oojae/strk20-governance
```

## Verify the address before you send to it

The interesting property is not that this computes a ballot address — it is
that it computes the *same* address the on-chain registry publishes. A voter can
check the destination an interface offers them instead of trusting it.

```ts
import { deriveBallotIdentity } from "@oojae/strk20-governance";
import { RpcProvider, shortString } from "starknet";

const provider = new RpcProvider({ nodeUrl: RPC });

// Read the separator from the registry rather than deriving it locally: a
// mismatch here produces perfectly valid addresses that nobody is voting to.
const [domain] = await provider.callContract({
  contractAddress: REGISTRY,
  entrypoint: "ballot_domain",
  calldata: [],
});

const { address } = deriveBallotIdentity(2n, "for", {
  ballotAccountClassHash: CLASS_HASH,
  daoMasterPublicKey: PUBLIC_KEY,
  domain,
});

const [published] = await provider.callContract({
  contractAddress: REGISTRY,
  entrypoint: "ballot_address",
  calldata: ["2", "0"],
});

if (BigInt(address) !== BigInt(published)) throw new Error("do not send");
```

The derivation is pinned against the Cairo implementation by a vector test in
both languages. Getting it wrong is not a subtle failure — Starknet's contract
address formula is one hash-on-elements over five inputs, and a plausible-looking
nested-Pedersen version yields addresses that are wrong but valid-looking, which
is how one Sepolia registry ended up publishing three addresses no account could
ever be deployed at.

## Count, reproducibly

`aggregateNotes` is pure and touches no network, so two parties with the same
notes get the same aggregate or find out why not. It deduplicates by note id,
because paginated discovery can legitimately return a note twice and
double-counting a vote would be silent.

```ts
import { aggregateNotes, willPass } from "@oojae/strk20-governance";

const tally = aggregateNotes({ for: forNotes, against: againstNotes, abstain: abstainNotes });
const passes = willPass(tally, quorum);
```

## What is here

| | |
|---|---|
| `deriveBallotIdentity`, `ballotDomain`, `ballotSalt` | where a ballot goes, matching the registry |
| `aggregateNotes`, `willPass` | the tally, as a pure function |
| `deriveBallotViewingKey`, `assertValidViewingKey` | per-ballot viewing keys, from a seed that never leaves your process |
| `computePayoutCommitment`, `mintPayout` | treasury payout commitments, pinned against Cairo by a shared vector |
| `parseTokenAmount`, `assertFits` | token amounts that refuse to silently truncate |
| `classifyReceipt` | whether a transaction actually touched the pool |
| `DEPLOYMENTS`, `LEDGER` | live addresses and every transaction, each verified against the chain |

## What this does not do

It builds no proofs, holds no keys, and sends no transactions. Shielding,
casting and claiming are pool operations that need the STRK20 SDK or a wallet;
this package is the arithmetic both routes have to agree on.

**It also does not make a vote private on its own.** Privacy comes from the
pool. Read [`docs/TRUST_MODEL.md`](https://github.com/OoJae/aperture-strk20/blob/main/docs/TRUST_MODEL.md)
before telling anyone their ballot is secret: open-note amounts are public, a
treasury payout hides the recipient rather than the amount, the tally operator
can read individual ballots, and the scheme is not receipt-free.

## License

MIT
