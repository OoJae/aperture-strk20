import {
  ACTIVE,
  DEPLOYMENTS,
  nonScoring,
  scoring,
  txUrl,
} from "@aperture/strk20-governance";
import { Chrome } from "../components/Chrome.tsx";
import {
  ANONYMIZER_ADDRESS,
  POOL_ADDRESS,
  REGISTRY_ADDRESS,
  VOYAGER,
  shortHex,
} from "../lib/chain.ts";

/**
 * The record.
 *
 * Every hash and every address on this page comes from the shared ledger, which
 * is also what generates strk20.json. They used to be independent literals, and
 * they drifted: this page filed a transaction under "through our own contracts"
 * that emits no event from any contract of ours, and three separate files
 * disagreed about how many payouts had run.
 */

const CONTRACTS = [
  { name: "ProposalRegistry", address: REGISTRY_ADDRESS },
  { name: "GovernanceAnonymizer", address: ANONYMIZER_ADDRESS },
  { name: "STRK20 pool", address: POOL_ADDRESS },
];

const SCORED = scoring(ACTIVE);
const OTHERS = nonScoring(ACTIVE);
const POOL_ONLY = OTHERS.filter((e) => e.kind !== "fund-anonymizer");
const FUNDING = OTHERS.filter((e) => e.kind === "fund-anonymizer");

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
          Contracts on {DEPLOYMENTS[ACTIVE].label}, transactions on Voyager.
          Nothing below asks you to believe a screenshot — including the parts
          that are unflattering.
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
          {SCORED.length} transactions through our own contracts
        </p>
        <p className="fade dim" data-reveal data-delay="60">
          Each of these emits an event from GovernanceAnonymizer, which is what
          makes it a transaction through Aperture&rsquo;s code rather than one
          that merely touched the pool.
        </p>
        <ul className="rows plain">
          {SCORED.map((t, i) => (
            <li className="row row--tall fade" key={t.hash} data-reveal data-delay={i * 60}>
              <div>
                <strong>{t.what}</strong>
                <p className="dim">{t.detail}</p>
              </div>
              <a className="mono dim" href={txUrl(t)} target="_blank" rel="noreferrer">
                {shortHex(t.hash, 10, 6)}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <hr className="rule" />

      <section className="shell block honest">
        <p className="label" data-reveal>
          And {POOL_ONLY.length + FUNDING.length} that do not
        </p>
        <p className="fade" data-reveal data-delay="80">
          A record that only shows the flattering half is not a record.{" "}
          {POOL_ONLY.length} of these touched the pool but ran through
          nobody&rsquo;s code but the pool&rsquo;s.
        </p>
        <ul className="rows plain fade" data-reveal data-delay="140">
          {POOL_ONLY.map((t) => (
            <li className="row" key={t.hash}>
              <span className="dim">{t.what}</span>
              <a className="mono dim" href={txUrl(t)} target="_blank" rel="noreferrer">
                {shortHex(t.hash, 10, 6)}
              </a>
            </li>
          ))}
        </ul>

        {FUNDING.map((t) => (
          <div className="fade" key={t.hash} data-reveal data-delay="200">
            <p className="banner-danger">
              <strong>{t.what}.</strong> {t.detail} An earlier version of this
              page listed it under &ldquo;through our own contracts&rdquo; and{" "}
              <span className="mono">docs/DEPLOYMENTS.md</span> said it counted.
              Both were wrong, and one RPC call falsifies them:{" "}
              <a className="mono" href={txUrl(t)} target="_blank" rel="noreferrer">
                {shortHex(t.hash, 10, 6)}
              </a>{" "}
              emits zero events from either of our contracts.
            </p>
          </div>
        ))}
      </section>

      <hr className="rule" />

      <section className="shell block honest">
        <p className="label" data-reveal>
          Value we locked up and cannot get back
        </p>
        <p className="fade" data-reveal data-delay="80">
          GovernanceAnonymizer holds <strong>14 STRK</strong> that nobody can
          ever move. Six payouts were registered against commitments whose
          preimages the demo displayed once and never stored, the claim leg has
          never succeeded on any network, and the contract has no sweep
          function, no owner, and no <span className="mono">transfer</span> in
          its token interface. That is not a bug we have yet to fix — it is a
          property of a contract that cannot be changed after deployment, and it
          cost real money to learn.
        </p>
      </section>

      <hr className="rule" />

      <section className="shell block">
        <p className="label" data-reveal>
          Where the vote lifecycle actually runs
        </p>
        <p className="fade" data-reveal data-delay="80">
          On <strong>{DEPLOYMENTS.sepolia.label}</strong>, not here. Three ballot
          identities are deployed and registered with the pool there, and one
          real sealed ballot was cast and finalized at 5 STRK for &mdash; though
          that ballot arrived 945 blocks after the voting window closed, and the
          counting code as it stands today scores it zero. It is being re-run
          inside the window rather than left to imply a clean result. On{" "}
          {DEPLOYMENTS[ACTIVE].label} no ballot identity is deployed, so the
          addresses this site derives are addresses nothing can receive at. The
          contracts and the payouts are real on mainnet; the voting is not.
        </p>
      </section>
    </Chrome>
  );
}
