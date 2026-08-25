import { DEPLOYMENTS, ACTIVE } from "@oojae/strk20-governance";
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

const STEPS = [
  {
    n: "01",
    what: "Announce",
    hash: "0x1288aa459a8a7a1f85a4a4b61eb9d7045a551f4be0f19d69d3c451669db110f",
    detail:
      "Reserves 1 STRK of the proposal's 2 STRK cap and records the block. Grants nothing — the anonymizer will still refuse to escrow against it.",
  },
  {
    n: "02",
    what: "Wait 1800 blocks",
    hash: null,
    detail:
      "About an hour. The payout is public and unusable for the whole of it, which is the window in which anyone watching the registry could object.",
  },
  {
    n: "03",
    what: "Authorize",
    hash: "0x7c34cb2221ed5b8a7e375615c8463b40508fbae888eed8fe67e1200ae84562a",
    detail:
      "Two of three signers confirmed and the multisig executed. No single key can reach this state.",
  },
  {
    n: "04",
    what: "Register",
    hash: "0x144fdb94ec51ef1f462bbb185538fd852a5d2e441879841b29cf7a892710bdb",
    detail:
      "The pool withdrew to GovernanceAnonymizer and called its privacy_invoke. The contract checked the licence and its own escrow ledger before parking the value against a commitment.",
  },
  {
    n: "05",
    what: "Claim",
    hash: "0x500f21db7e4864ca024fd1c9febcd8b8c8c1408282b72aa0eb926a02b4d0491",
    detail:
      "The preimage opened the commitment. Afterwards the anonymizer's outstanding and unattached both read zero — nothing stranded.",
  },
] as const;

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
