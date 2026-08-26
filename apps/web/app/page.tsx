import { Chrome } from "./components/Chrome.tsx";
import { ACTIVE, DEMO_VIDEO, LEDGER, scoring } from "@oojae/strk20-governance";
import { TEST_COUNTS } from "./lib/counts.ts";
import { REGISTRY_ADDRESS, VOYAGER, shortHex } from "./lib/chain.ts";

/**
 * Sealed ballots cast on the active network, counted rather than quoted.
 *
 * A number in a sentence is a claim, and this repository's characteristic
 * failure is a claim that was true once.
 */
const BALLOTS_CAST = LEDGER.filter(
  (e) => e.network === ACTIVE && e.kind === "ballot-cast",
).length;

export default function Home() {
  return (
    <Chrome>
      {/* The hero is the thesis: an aperture almost shut, and the sentence that
          explains why that is the product. */}
      <section className="hero shell">
        {/* "Live on mainnet" belongs above the fold. It was two and a half
            viewports down, which is past the point a judge has decided whether
            this is a demo or a deployed thing. */}
        <p className="label hero-eyebrow fade" data-reveal>
          Sealed-ballot governance · STRK20 ·{" "}
          <span className="accent">Live on Starknet mainnet</span>
        </p>

        <h1 className="hero-line">
          <span className="reveal" data-reveal>
            <span>Votes go in</span>
          </span>
          <span className="reveal" data-reveal data-delay="90">
            <span>
              <em>sealed.</em>
            </span>
          </span>
          <span className="reveal hero-last" data-reveal data-delay="180">
            <span>Only the total comes out.</span>
          </span>
        </h1>

        <div className="hero-foot fade" data-reveal data-delay="380">
          <p>
            A vote is a private transfer. No observer sees the choice, the
            weight, or the voter — not while the vote is open, and not after it
            closes. The tally operator does: it holds the viewing keys, and that
            is the trade this design makes.{" "}
            <a className="link-inline" href="/trust">
              What we ask you to trust →
            </a>
          </p>
          <a className="cta" href="/app">
            Open the app
            <span aria-hidden="true">→</span>
          </a>
          {DEMO_VIDEO ? (
            <p className="fade dim hero-film">
              Short on time?{" "}
              <a className="link-inline" href={DEMO_VIDEO}>
                Watch the film · 2:37 →
              </a>
            </p>
          ) : null}
        </div>
      </section>

      <hr className="rule" />

      {/* Structure that encodes something true: these are the three leaks, and
          they are the reason the project exists. Not decoration. */}
      <section className="shell block">
        <p className="label" data-reveal>
          The problem
        </p>
        <div className="leaks">
          {[
            {
              n: "01",
              h: "Whales move the room",
              p: "A large holder's vote is visible the moment it lands, so everyone after them votes knowing it.",
            },
            {
              n: "02",
              h: "Bought votes are easy to police",
              p: "When ballots are public, a buyer can confirm at a glance that the vote they paid for was cast.",
            },
            {
              n: "03",
              h: "Payouts are doxxed",
              p: "Grant recipients and amounts sit in the open for anyone watching to read, and to front-run.",
            },
          ].map((leak, i) => (
            <article className="leak fade" key={leak.n} data-reveal data-delay={i * 90}>
              <span className="label accent">{leak.n}</span>
              <h3>{leak.h}</h3>
              <p className="dim">{leak.p}</p>
            </article>
          ))}
        </div>
      </section>

      <hr className="rule" />

      <section className="shell block split">
        <div>
          <p className="label" data-reveal>
            What it does
          </p>
          <h2 className="reveal" data-reveal data-delay="60">
            <span>Controlled disclosure.</span>
          </h2>
        </div>
        <div className="fade" data-reveal data-delay="140">
          <p>
            Each proposal derives one receiving identity per choice, from public
            inputs. Casting a ballot means privately moving your shielded weight
            into the identity for the choice you want. On-chain, an observer sees
            a pool transaction and nothing else.
          </p>
          <p>
            You do not have to take that on faith. The app derives every ballot
            address in your browser and shows it beside what the contract
            publishes, so you can check the page rather than trust it.
          </p>
          <a className="link" href="/how">
            How it works <span aria-hidden="true">→</span>
          </a>
        </div>
      </section>

      <hr className="rule" />

      {/* Evidence, stated flatly. The strongest thing this project has is that
          it is real, so the numbers get room rather than ornament. */}
      <section className="shell block">
        <p className="label" data-reveal>
          On mainnet, not in theory
        </p>
        <dl className="facts">
          {[
            // The ballot leads, because it is what this project is about and
            // it is now a thing that happened rather than a thing that could.
            // The stat here used to be scoring(ACTIVE).length labelled
            // "payouts", which stopped being true the moment the scoring set
            // grew to include creating a proposal, publishing a tally and
            // licensing a payout — none of which is a payout.
            //
            // Then it was the literal "1", which stopped being true the moment
            // a second ballot was cast against v3. Counting the ledger is the
            // only version of this that cannot go stale.
            {
              k: String(BALLOTS_CAST),
              v: `sealed ballot${BALLOTS_CAST === 1 ? "" : "s"} cast, counted and finalized on mainnet`,
            },
            {
              k: String(scoring(ACTIVE).length),
              v: "mainnet transactions through our own Cairo contracts",
            },
            {
              k: String(TEST_COUNTS.total),
              v: "tests across Cairo and TypeScript",
            },
          ].map((f, i) => (
            <div className="fact fade" key={f.k} data-reveal data-delay={i * 80}>
              <dt>{f.k}</dt>
              <dd className="dim">{f.v}</dd>
            </div>
          ))}
        </dl>
        <p className="fade dim facts-note" data-reveal data-delay="260">
          Registry{" "}
          <a
            className="mono"
            href={`${VOYAGER}/contract/${REGISTRY_ADDRESS}`}
            target="_blank"
            rel="noreferrer"
          >
            {shortHex(REGISTRY_ADDRESS, 10, 6)}
          </a>
          . Every hash is in <a href="/proof">the record</a>.
        </p>
      </section>

      <hr className="rule" />

      {/* Candour as a feature. Most projects bury this; here it earns its own
          panel, because overclaiming privacy is worse than not having it. */}
      <section className="shell block honest">
        <p className="label" data-reveal>
          What it does not do
        </p>
        <h2 className="reveal" data-reveal data-delay="60">
          <span>Shielding is public.</span>
        </h2>
        <p className="fade" data-reveal data-delay="140">
          Depositing into the pool publishes your address, the token, and the
          amount. Privacy starts with what happens after. A treasury payout hides
          who was paid, not how much. And a voter who <em>wants</em> to prove how
          they voted still can — we raise the cost of buying votes, we do not
          make it impossible.
        </p>
        <a className="link fade" data-reveal data-delay="200" href="/trust">
          The whole accounting <span aria-hidden="true">→</span>
        </a>
      </section>
    </Chrome>
  );
}
