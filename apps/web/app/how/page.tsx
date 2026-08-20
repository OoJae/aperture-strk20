import { Chrome } from "../components/Chrome.tsx";

/**
 * Numbered because this genuinely is a sequence — a ballot's life, in order.
 * Numbering anything else here would be decoration.
 */
const STEPS = [
  {
    n: "01",
    h: "Shield",
    p: "You deposit into the STRK20 pool. This part is public: your address, the token, and the amount are all visible. Privacy begins after it.",
    aside: "Public",
  },
  {
    n: "02",
    h: "Derive the destination",
    p: "Each proposal has one receiving identity per choice, derived from public inputs. Your browser computes it independently and checks it against what the contract publishes, so you never take the address on faith.",
    aside: "Verifiable",
  },
  {
    n: "03",
    h: "Cast",
    p: "Your ballot is a private transfer into the identity for your choice. On-chain it emits a nullifier and an encrypted note — no amount, no voter, no choice. The sender is a relayer, not you.",
    aside: "Sealed",
  },
  {
    n: "04",
    h: "Wait",
    p: "Nothing is countable from the outside while voting is open. There is no running total to react to, so nobody votes because of what someone else did.",
    aside: "Sealed",
  },
  {
    n: "05",
    h: "Tally",
    p: "After the window closes, the tally service reads what each identity received, sums it, and publishes only the aggregate on-chain. Individual ballots never leave it.",
    aside: "Aggregate",
  },
];

export default function How() {
  return (
    <Chrome>
      <section className="hero hero--page shell">
        <p className="label fade" data-reveal>
          How it works
        </p>
        <h1 className="hero-line">
          <span className="reveal" data-reveal>
            <span>The life of</span>
          </span>
          <span className="reveal" data-reveal data-delay="90">
            <span>
              a <em>ballot.</em>
            </span>
          </span>
        </h1>
        <p className="fade" data-reveal data-delay="220">
          Five steps. Only the first and the last are visible to anyone watching
          the chain.
        </p>
      </section>

      <hr className="rule" />

      <section className="shell block">
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li className="step fade" key={s.n} data-reveal data-delay={i * 70}>
              <span className="label accent step-n">{s.n}</span>
              <div className="step-body">
                <h3>{s.h}</h3>
                <p className="dim">{s.p}</p>
              </div>
              <span className="label step-aside">{s.aside}</span>
            </li>
          ))}
        </ol>
      </section>

      <hr className="rule" />

      <section className="shell block honest">
        <p className="label" data-reveal>
          Why a transfer
        </p>
        <h2 className="reveal" data-reveal data-delay="60">
          <span>A spent note cannot vote twice.</span>
        </h2>
        <p className="fade" data-reveal data-delay="140">
          Double-voting protection is not a rule Aperture enforces — it falls out
          of the pool itself. Notes are spent when they are transferred, so the
          same weight cannot be cast again. The mechanism that makes the vote
          private is the same one that makes it honest.
        </p>
        <a className="link fade" data-reveal data-delay="200" href="/app">
          See it running <span aria-hidden="true">→</span>
        </a>
      </section>
    </Chrome>
  );
}
