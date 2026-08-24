import {
  ACTIVE,
  DEPLOYMENTS,
  nonScoring,
  scoring,
  txUrl,
} from "@oojae/strk20-governance";
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

const CONTRACTS: { name: string; address: string; superseded?: string }[] = [
  { name: "ProposalRegistry", address: REGISTRY_ADDRESS },
  { name: "GovernanceAnonymizer", address: ANONYMIZER_ADDRESS },
  { name: "STRK20 pool", address: POOL_ADDRESS },
  // Superseded generations belong on this page, because most of the
  // transactions below ran through them. Listing only the live pair would put
  // ten transactions next to two contracts that none of them touched, which is
  // the kind of gap a page called "everything here is checkable" cannot have.
  ...(DEPLOYMENTS[ACTIVE].superseded ?? []).map((s) => ({
    name: s.role,
    address: s.address,
    superseded: s.why,
  })),
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
              <span>
                {c.name}
                {c.superseded ? (
                  <span className="dim"> · superseded, kept because transactions below touched it</span>
                ) : null}
              </span>
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
          Each of these emits an event from one of our own contracts —
          GovernanceAnonymizer for the payout legs, ProposalRegistry for creating
          a proposal, publishing a tally and licensing a payout — which is what
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
          <strong>34.5 STRK</strong> is locked in contracts nobody can move it
          out of — 14 in the superseded mainnet anonymizer{" "}
          <span className="mono">0x05cc31d1…</span> and 20.5 in its Sepolia
          counterpart. Payouts were registered there against commitments whose
          preimages were displayed once and never stored, and neither contract
          has a sweep function, an owner, or a{" "}
          <span className="mono">transfer</span> in its token interface. That is
          not a bug we have yet to fix — it is a property of a contract that
          cannot be changed after deployment, and it cost real money to learn.
        </p>
        <p className="fade dim" data-reveal data-delay="140">
          Both causes are fixed, and both fixes were proved by doing the thing
          rather than by asserting it. The claim leg was failing on a stale note
          index; it now waits for the settled pin to pass the register
          transaction, and a payout has since been registered and claimed on
          mainnet. Preimages are written to disk before anything is submitted.
          None of that returns the 34.5 STRK, which is why it is still here.
        </p>
      </section>

      <hr className="rule" />

      <section className="shell block">
        <p className="label" data-reveal>
          Where the vote lifecycle actually runs
        </p>
        <p className="fade" data-reveal data-delay="80">
          On <strong>{DEPLOYMENTS[ACTIVE].label}</strong>. Three ballot
          identities are deployed at the addresses this registry publishes and
          registered with the pool, and one real sealed ballot was cast{" "}
          <em>inside its voting window</em>, counted, and finalized at 5 STRK
          for. The published tally names the block it counted through, and the
          contract requires that block to be the window&rsquo;s close &mdash; so
          the count is reproducible by anyone reading the same state, rather than
          taken on our word.
        </p>
        <p className="fade dim" data-reveal data-delay="140">
          This section used to say the voting was Sepolia-only, and that the one
          Sepolia ballot had arrived <strong>945 blocks after its window
          closed</strong> &mdash; counted anyway by a worker that filtered
          nothing, and scored zero by the code as it stands now. That result is
          still in the history with the correction attached. Binding the window
          on chain is the fix, and this mainnet ballot is the first one cast
          under it.
        </p>
      </section>
    </Chrome>
  );
}
