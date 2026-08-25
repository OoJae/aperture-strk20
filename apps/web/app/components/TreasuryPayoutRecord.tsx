import { DEPLOYMENTS, ACTIVE, latestPayoutSequence } from "@oojae/strk20-governance";
import { VOYAGER, shortHex } from "../lib/chain.ts";

/**
 * The treasury payout, as a record rather than a button.
 *
 * This page used to offer a wallet a live "register a payout" action. Under v3
 * that cannot work, and the reason is the point rather than a limitation: a
 * payout needs `announce_payout`, then 1800 blocks, then `authorize_payout` —
 * both callable only by the registry's tally_operator, which is a 2-of-3
 * multisig. A browser wallet is not the operator, cannot reach a quorum alone,
 * and cannot wait out a timelock mid-click.
 *
 * There is no clever way to keep the button. The commitment is minted with a
 * random secret in the browser, so a licence cannot be pre-authorised for a
 * hash that does not exist yet. Showing what actually happened is the honest
 * substitute, and it is a better demonstration anyway: a stranger being unable
 * to move a DAO's treasury is the feature.
 */

/**
 * Derived from the ledger rather than retyped.
 *
 * These steps used to carry their transaction hashes as literals, which is the
 * drift `scripts/tests/claims.test.ts` exists to prevent: one fact stored twice,
 * with the copy in the component free to go stale the moment a payout is re-run.
 *
 * Which four legs those are is a ledger question rather than a presentation one,
 * so it lives in the package as `latestPayoutSequence()` where it is tested.
 * Only the labels below are presentation, and a label cannot drift from the
 * chain.
 */
type Step = {
  readonly n: string;
  readonly what: string;
  readonly hash: string | null;
  readonly detail: string;
};

const { announced, licensed, registered, claimed } = latestPayoutSequence();

const LEGS = [
  { leg: announced, label: "Announce" },
  { leg: licensed, label: "Authorize" },
  { leg: registered, label: "Register" },
  { leg: claimed, label: "Claim" },
] as const;

const STEPS: readonly Step[] = LEGS.flatMap(({ leg, label }): Step[] => {
  if (!leg) return [];
  const step: Step = { n: "", what: label, hash: leg.hash, detail: leg.detail };
  // The wait is not a transaction, so it has no ledger entry of its own. It is
  // the gap between announcing and licensing — measured, not asserted.
  if (label === "Authorize" && announced) {
    return [
      {
        n: "",
        what: `Wait ${(leg.block - announced.block).toLocaleString("en-US")} blocks`,
        hash: null,
        detail:
          "About an hour, against the 1800-block minimum the registry enforces. The payout is public and unusable for the whole of it, which is the window in which anyone watching the registry could object.",
      },
      step,
    ];
  }
  return [step];
}).map((s, i) => ({ ...s, n: String(i + 1).padStart(2, "0") }));

export function TreasuryPayoutRecord() {
  const deployment = DEPLOYMENTS[ACTIVE];
  return (
    <section className="shell block">
      <p className="label">A treasury payout, start to finish</p>
      <p className="fade">
        The recipient is hidden; the amount is not. An open note carries a
        plaintext value, so this hides <em>who</em> was paid rather than{" "}
        <em>how much</em>.
      </p>

      <ol className="steps">
        {STEPS.map((s) => (
          <li className="step" key={s.n}>
            <span className="label accent step-n">{s.n}</span>
            <div className="step-body">
              <p>
                <strong>{s.what}</strong>
                {s.hash ? (
                  <>
                    {" · "}
                    <a
                      className="mono dim"
                      href={`${VOYAGER}/tx/${s.hash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {shortHex(s.hash, 10, 6)}
                    </a>
                  </>
                ) : null}
              </p>
              <p className="dim">{s.detail}</p>
            </div>
          </li>
        ))}
      </ol>

      <p className="fade dim">
        There is no button here, and that is the design rather than a missing
        feature. Steps 01 and 03 are callable only by the registry&rsquo;s
        tally_operator, which is a{" "}
        <a
          className="mono"
          href={`${VOYAGER}/contract/${deployment.multisig}`}
          target="_blank"
          rel="noreferrer"
        >
          2-of-3 multisig
        </a>
        . A visitor with a wallet cannot reach a quorum, and could not wait out
        the timelock if they did. A stranger being unable to move a DAO&rsquo;s
        treasury is the point.
      </p>
      <p className="fade dim">
        Being honest about the other half: all three signing keys belong to this
        project&rsquo;s maintainer, so what is deployed is the machinery for
        shared custody rather than shared custody. A quorum can add real
        co-signers without redeploying anything.
      </p>
    </section>
  );
}
