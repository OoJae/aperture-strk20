"use client";

/**
 * Where a vote would go, and whether anything is there to receive it.
 *
 * This panel used to show one badge, a green "match", meaning the browser's
 * derivation equalled the registry's. That is true and nearly content-free:
 * both sides derive from the same public inputs — proposal id, choice, ballot
 * account class hash, DAO master public key — and none of those name a registry
 * or a chain. So the badge matches on every network, always, deployed or not.
 *
 * On the v1 mainnet deployment all three of these addresses had no contract at
 * them. A visitor following the site's own instructions and sending STRK to a
 * green "match" would have lost it. The check the panel was missing is the one
 * that matters, and it is still the one it makes: is anything actually deployed
 * and registered there. Under v3 all three are, which is a fact the panel reads
 * from the chain rather than a claim made here.
 */

import { CHOICES, deriveBallotIdentity } from "@oojae/strk20-governance";
import type { Choice } from "@oojae/strk20-governance";
import {
  BALLOT_CONFIG,
  DEPLOYMENT,
  VOYAGER,
  getBallotAddressOnChain,
  isDeployed,
  isRegisteredWithPool,
  shortHex,
} from "../lib/chain.ts";
import { useChainRead } from "../lib/useChainRead.ts";

const CHOICE_INDEX: Record<Choice, number> = { for: 0, against: 1, abstain: 2 };

interface Row {
  choice: Choice;
  derived: string;
  onChain: string;
  /** The two derivations agree. Necessary, and nowhere near sufficient. */
  matches: boolean;
  /** A contract exists at the address. */
  deployed: boolean;
  /** The pool holds a viewing key for it, so a transfer to it is readable. */
  registered: boolean;
}

export function BallotIdentities({ proposalId }: { proposalId: bigint }) {
  const state = useChainRead<Row[]>(
    async () =>
      Promise.all(
        CHOICES.map(async (choice) => {
          const derived = deriveBallotIdentity(proposalId, choice, BALLOT_CONFIG).address;
          const onChain = await getBallotAddressOnChain(proposalId, CHOICE_INDEX[choice]);
          const [deployed, registered] = await Promise.all([
            isDeployed(derived),
            isRegisteredWithPool(derived),
          ]);
          return {
            choice,
            derived,
            onChain,
            matches: BigInt(onChain) === BigInt(derived),
            deployed,
            registered,
          };
        }),
      ),
    [proposalId.toString()],
  );

  const rows = state.status === "ready" ? state.data : [];
  const anyMissing = rows.some((r) => !r.deployed || !r.registered);

  return (
    <section className="panel">
      <h2>Where a vote for proposal #{proposalId.toString()} would go</h2>
      <p className="lede">
        Each choice has its own receiving identity. Your browser derives these
        addresses from public inputs and compares them against what the contract
        publishes, and then asks the network whether anything is actually there.
      </p>

      {state.status === "error" ? (
        <>
          <p className="bad" role="alert">
            Could not check these addresses: {state.message}
          </p>
          <button type="button" className="cta" onClick={state.retry}>
            Try again
          </button>
        </>
      ) : null}

      {state.status === "loading" ? (
        <p className="dim" role="status" aria-live="polite">
          Deriving and checking three addresses on {DEPLOYMENT.label}…
        </p>
      ) : null}

      {anyMissing ? (
        <p className="banner-danger" role="alert">
          <strong>Do not send STRK to these addresses on {DEPLOYMENT.label}.</strong>{" "}
          No account is deployed at {rows.filter((r) => !r.deployed).length === 3 ? "any" : "one or more"}{" "}
          of them, and a transfer to an undeployed address is unrecoverable.
          Standing a ballot identity up means registering its viewing key with
          the pool, which is a pool transaction needing a proof.
        </p>
      ) : null}

      {rows.length > 0 ? (
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label={`Ballot identities for proposal ${proposalId.toString()}`}
        >
          <table>
            <caption className="dim small">
              Derived in your browser, compared against the contract, then checked
              against {DEPLOYMENT.label}.
            </caption>
            <thead>
              <tr>
                <th scope="col">Choice</th>
                <th scope="col">Address</th>
                <th scope="col">Derivation</th>
                <th scope="col">Live here</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.choice}>
                  <th scope="row" className="choice">
                    {row.choice}
                  </th>
                  <td className="mono">
                    <a
                      href={`${VOYAGER}/contract/${row.derived}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {shortHex(row.derived, 10, 6)}
                    </a>
                  </td>
                  <td>
                    {row.matches ? (
                      <span className="badge">derivation matches</span>
                    ) : (
                      <span className="badge badge-danger">MISMATCH</span>
                    )}
                  </td>
                  <td>
                    {row.deployed && row.registered ? (
                      <span className="badge badge-live">deployed · registered</span>
                    ) : row.deployed ? (
                      <span className="badge badge-danger">not registered</span>
                    ) : (
                      <span className="badge badge-danger">not deployed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="dim small">
        &ldquo;Derivation matches&rdquo; means your browser and the contract
        compute the same address from the same public inputs. Because that
        derivation depends only on the proposal id, the choice, the ballot
        account class hash and the DAO master public key — not on the registry
        or the chain — it matches on every network, always. It is not evidence
        that an account exists there, which is why the last column asks
        separately.
      </p>
    </section>
  );
}
