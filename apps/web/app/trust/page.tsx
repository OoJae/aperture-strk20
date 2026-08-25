import { Chrome } from "../components/Chrome.tsx";

const PRIVATE = [
  "Which choice you voted for",
  "How much weight you voted with",
  "The link between you and your choice",
  "Who receives a treasury payout",
];

const PUBLIC = [
  "Shielding — your address, the token, and the amount",
  "Proposal metadata and voting windows",
  "The final aggregate tally",
  "The amount of a payout, though not its recipient",
];

/** The things we are trusted on. Naming them is the point of the page. */
const TRUSTED = [
  {
    h: "The tally operator",
    p: "It holds every ballot identity's viewing key, so it can see individual ballots. It is trusted to publish only the aggregate.",
  },
  {
    h: "The published tally",
    p: "Nothing proves the operator's sum is the correct one. A second party with the same keys can re-run the count and compare, but that audits the operator against itself.",
  },
  {
    h: "The discovery service",
    p: "The tally worker learns which notes arrived by asking an indexer. A dishonest or broken one can under-report, and a tally computed from an incomplete read is wrong in a way nothing on-chain reveals. It is also handed a viewing key in cleartext, so it can read the ballots it is reporting on. docs/TRUST_MODEL.md has named this party from the start; this page did not, which was the more serious omission of the two.",
  },
  {
    h: "Refunds",
    p: "They execute. 5 STRK has gone back to the voter who staked it, on mainnet and on Sepolia, as a private transfer to the account the note came from. This was blocked for two reasons rather than the one usually given: a refund needs a proving service, and it needs a payee — and the worker used to discard the sender of each note as it read it, so the queue had no recipient recorded even in principle. What remains is economics rather than capability. A pool transaction costs a flat 6 STRK on mainnet, so refunding a 5 STRK ballot destroys more than it returns, one note at a time. Batching a proposal's refunds into a single pool transaction is the fix, and it is not built.",
  },
  {
    h: "Value sent to the anonymizer without a commitment",
    p: "It is gone. The contract has no sweep, no owner, and no transfer in its token interface: value leaves only as an allowance granted to the pool when a registered commitment is claimed. 34.5 STRK is permanently locked that way today, across the superseded mainnet and Sepolia anonymizers. That is a deliberate trade — immutability with no privileged role, at the cost of no recovery — and it has already cost real money.",
  },
];

export default function Trust() {
  return (
    <Chrome>
      <section className="hero hero--page shell">
        <p className="label fade" data-reveal>
          What&rsquo;s private
        </p>
        <h1 className="hero-line">
          <span className="reveal" data-reveal>
            <span>Overclaiming</span>
          </span>
          <span className="reveal" data-reveal data-delay="90">
            <span>
              is <em>worse</em> than
            </span>
          </span>
          <span className="reveal" data-reveal data-delay="180">
            <span>not having it.</span>
          </span>
        </h1>
        <p className="fade" data-reveal data-delay="300">
          So here is the whole thing, including the parts that do not flatter us.
        </p>
      </section>

      <hr className="rule" />

      <section className="shell block ledger">
        <div className="fade" data-reveal>
          <p className="label accent">Private</p>
          <ul className="plain">
            {PRIVATE.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
        <div className="fade" data-reveal data-delay="90">
          <p className="label">Public</p>
          <ul className="plain dim">
            {PUBLIC.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      </section>

      <hr className="rule" />

      {/* The section most projects would not write. It is here because a trust
          model you cannot check is not a trust model. */}
      <section className="shell block">
        <p className="label" data-reveal>
          Trusted today
        </p>
        <div className="leaks">
          {TRUSTED.map((t, i) => (
            <article className="leak fade" key={t.h} data-reveal data-delay={i * 90}>
              <h3>{t.h}</h3>
              <p className="dim">{t.p}</p>
            </article>
          ))}
        </div>
      </section>

      <hr className="rule" />

      <section className="shell block honest">
        <p className="label" data-reveal>
          The sharpest limit
        </p>
        <h2 className="reveal" data-reveal data-delay="60">
          <span>You can still prove how you voted.</span>
        </h2>
        <p className="fade" data-reveal data-delay="140">
          Ballot secrecy means an observer cannot tell how you voted. Aperture
          has that. <em>Receipt-freeness</em> means you could not prove it even
          if you wanted to — and Aperture does not have that. The ballot address
          is a public label of the choice, so a voter who hands over their
          viewing key hands over a receipt anyone can check against our own
          contract.
        </p>
        <p className="fade dim" data-reveal data-delay="200">
          What we genuinely remove is the free, public, at-scale verifiability
          that makes trustless bribery markets work. A buyer now has to deal with
          each seller individually and trust what they are shown. That is a real
          increase in cost. It is not coercion resistance, and we do not call it
          that.
        </p>
        <a
          className="link fade"
          data-reveal
          data-delay="260"
          href="https://github.com/OoJae/aperture-strk20/blob/main/docs/TRUST_MODEL.md"
        >
          Read the full trust model <span aria-hidden="true">→</span>
        </a>
      </section>
    </Chrome>
  );
}
