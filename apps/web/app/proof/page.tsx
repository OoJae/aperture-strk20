import { Chrome } from "../components/Chrome.tsx";
import {
  ANONYMIZER_ADDRESS,
  POOL_ADDRESS,
  REGISTRY_ADDRESS,
  VOYAGER,
  shortHex,
} from "../lib/chain.ts";

/**
 * The record. Every claim on this site should be checkable, so the evidence
 * gets its own page rather than a footnote — including the three transactions
 * that do not count, because hiding those would be the same overclaiming the
 * trust model refuses.
 */
const SCORED = [
  {
    hash: "0x2ee291e2fc083896143f0bb063694b795aa918239cca50fe06021ac32150fb2",
    what: "Payout through the anonymizer",
    detail: "Pool withdrew to our contract, called privacy_invoke, value parked against a commitment.",
  },
  {
    hash: "0x31b96770b38847d43631af41813bdc54335e7628f850411e856b07f4e009326",
    what: "Payout through the anonymizer",
    detail: "Same path, a second commitment.",
  },
  {
    hash: "0x4ed6e16702fe98bea43e7a26bc54bf76353ab4fa49f9341dc39cf20bd4e390d",
    what: "Payout through the anonymizer",
    detail: "Same path, a third commitment.",
  },
  {
    hash: "0x39d820c7b45e7d1752cd7d3171b689437c045d3bd1a5526e5259e49c8faca81",
    what: "Treasury funded",
    detail: "Moved value into the anonymizer without invoking it — the shallower of the four.",
  },
];

const UNSCORED = [
  { hash: "0x05331694f88f34223c8c1a5445e449b552dfe2b28c93ae26bb6d5699e8443ec1", what: "Shield" },
  { hash: "0x02e3cee5560517e9472d977fe11d4c81ddbe0087df6ce2562d4711fe8a28e947", what: "Private transfer" },
  { hash: "0x020cc7f861d8c455df4b4f84c284ff3dcb96a6f1f94898e95a4a1a2ec919803b", what: "Unshield" },
];

const CONTRACTS = [
  { name: "ProposalRegistry", address: REGISTRY_ADDRESS },
  { name: "GovernanceAnonymizer", address: ANONYMIZER_ADDRESS },
  { name: "STRK20 pool", address: POOL_ADDRESS },
];

export default function Proof() {
  return (
    <Chrome>
      <section className="hero hero--page shell">
        <p className="label fade" data-reveal>
          The record
        </p>
        <h1 className="hero-line">
          <span className="reveal" data-reveal>
            <span>Everything here</span>
          </span>
          <span className="reveal" data-reveal data-delay="90">
            <span>
              is <em>checkable.</em>
            </span>
          </span>
        </h1>
        <p className="fade" data-reveal data-delay="220">
          Contracts on Starknet mainnet, transactions on Voyager. Nothing below
          asks you to believe a screenshot.
        </p>
      </section>

      <hr className="rule" />

      <section className="shell block">
        <p className="label" data-reveal>
          Contracts
        </p>
        <ul className="rows plain">
          {CONTRACTS.map((c, i) => (
            <li className="row fade" key={c.name} data-reveal data-delay={i * 70}>
              <span>{c.name}</span>
              <a
                className="mono dim"
                href={`${VOYAGER}/contract/${c.address}`}
                target="_blank"
                rel="noreferrer"
              >
                {shortHex(c.address, 12, 8)}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <hr className="rule" />

      <section className="shell block">
        <p className="label" data-reveal>
          Transactions through our own contracts
        </p>
        <ul className="rows plain">
          {SCORED.map((t, i) => (
            <li className="row row--tall fade" key={t.hash} data-reveal data-delay={i * 60}>
              <div>
                <strong>{t.what}</strong>
                <p className="dim">{t.detail}</p>
              </div>
              <a
                className="mono dim"
                href={`${VOYAGER}/tx/${t.hash}`}
                target="_blank"
                rel="noreferrer"
              >
                {shortHex(t.hash, 10, 6)}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <hr className="rule" />

      <section className="shell block honest">
        <p className="label" data-reveal>
          And three that do not count
        </p>
        <p className="fade" data-reveal data-delay="80">
          These touched the pool but ran through nobody&rsquo;s code but the
          pool&rsquo;s, so the sprint&rsquo;s checker rejects them. They are kept
          here because a record that only shows the flattering half is not a
          record.
        </p>
        <ul className="rows plain fade" data-reveal data-delay="140">
          {UNSCORED.map((t) => (
            <li className="row" key={t.hash}>
              <span className="dim">{t.what}</span>
              <a
                className="mono dim"
                href={`${VOYAGER}/tx/${t.hash}`}
                target="_blank"
                rel="noreferrer"
              >
                {shortHex(t.hash, 10, 6)}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </Chrome>
  );
}
