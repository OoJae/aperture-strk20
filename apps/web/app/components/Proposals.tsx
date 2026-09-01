"use client";

/**
 * Live proposal state, read straight from the registry.
 *
 * No wallet, no connection, no account. Someone opening this page for the first
 * time sees real contract state immediately — and, where that state is not what
 * it appears to be, is told so here rather than in a document they will not
 * open.
 */

import { willPass } from "@oojae/strk20-governance";
import {
  DEPLOYMENT,
  REGISTRY_ADDRESS,
  VOYAGER,
  decodeShortString,
  getBlockNumber,
  getProposal,
  getProposalCount,
  getTally,
  getPayoutTerms,
  getCountedThrough,
  getBallotCommitment,
  shortHex,
} from "../lib/chain.ts";
import type { Proposal, Tally, PayoutTerms } from "../lib/chain.ts";
import { formatWeightGroup } from "../lib/format.ts";
import { useChainRead } from "../lib/useChainRead.ts";
import { BallotIdentities } from "./BallotIdentities.tsx";

interface Loaded {
  proposal: Proposal;
  tally: Tally;
  /** The contract's verdict and, with it, where the tally came from. */
  terms: PayoutTerms;
  /** The block the tally was counted through. Zero until finalized. */
  countedThrough: bigint;
  /** Commitment to the exact ballot set counted. Zero until finalized. */
  commitment: string;
}

/**
 * A proposal's real state. The previous version was a single boolean,
 * `head <= endBlock`, which ignored startBlock and finalized both — so a
 * proposal that had not opened, and one that had already been finalized inside
 * its window, each rendered as "voting open".
 */
type Phase = "pending" | "open" | "closed" | "finalized";

function phaseOf(proposal: Proposal, head: bigint): Phase {
  if (proposal.finalized) return "finalized";
  if (head < proposal.startBlock) return "pending";
  if (head <= proposal.endBlock) return "open";
  return "closed";
}

function phaseLabel(phase: Phase, proposal: Proposal): string {
  switch (phase) {
    case "pending":
      return `opens at block ${proposal.startBlock.toLocaleString()}`;
    case "open":
      // Green here would claim a ballot can be cast. On a network with no
      // deployed ballot identity that is not true, and the tag says so.
      return DEPLOYMENT.ballotIdentitiesLive
        ? "voting open"
        : "open · no ballot identity on this network";
    case "closed":
      return "closed · awaiting tally";
    case "finalized":
      return "finalized";
  }
}

function TallyProvenance({
  proposal,
  tally,
  terms,
}: {
  proposal: Proposal;
  tally: Tally;
  terms: PayoutTerms;
}) {
  const total = tally.forWeight + tally.againstWeight + tally.abstainWeight;

  if (!proposal.finalized) {
    return (
      <div className="tally dim">
        No tally published. While voting is open there is nothing to count from
        the outside — that is the point.
      </div>
    );
  }

  if (total === 0n) {
    return (
      <p className="dim small">
        Finalized with a zero tally: the aggregate was published, but no ballots
        had been cast.
      </p>
    );
  }

  // Read from the registry, per proposal. This used to branch on a hardcoded
  // per-network flag, which cannot tell two proposals apart — and mainnet
  // genuinely holds both kinds, so it could label an operator-asserted tally as
  // counted.
  if (terms.provenance === "operator-asserted") {
    return (
      <p className="disclosure small">
        <strong>This aggregate was entered by the tally operator, not counted
        from ballots.</strong>{" "}
        The registry records its provenance as <span className="mono">OperatorAsserted</span>,
        so no ballot produced it. A passed proposal is a precondition for
        demonstrating a treasury payout at all, which is why it exists.{" "}
        <a href="/proof">The record →</a>
      </p>
    );
  }

  if (terms.provenance === "unset") {
    return (
      <p className="disclosure small">
        Finalized, but the registry records no provenance for this tally. That
        means it predates the field, so nothing on chain says where the number
        came from. <a href="/proof">The record →</a>
      </p>
    );
  }

  return (
    <p className="dim small">
      Counted from notes discovered at this proposal&rsquo;s ballot identities,
      and the registry records it as{" "}
      <span className="mono">BallotDerived</span>.
    </p>
  );
}

/**
 * The facts that make a published tally checkable, in the order `verify-tally`
 * checks them.
 *
 * This page cannot verify anything itself, and says so. Counting means
 * discovering the notes each ballot identity received, which needs that
 * identity&rsquo;s viewing key — so the honest affordance is to show what the
 * chain published and name the command that closes the loop.
 */
function TallyVerification({
  proposal,
  tally,
  countedThrough,
  commitment,
}: {
  proposal: Proposal;
  tally: Tally;
  countedThrough: bigint;
  commitment: string;
}) {
  if (!proposal.finalized) return null;

  // `finalize` asserts these are equal, so showing them agreeing shows the
  // contract's own guarantee rather than a claim about it.
  const pinned = countedThrough === proposal.endBlock;
  const turnout = tally.forWeight + tally.againstWeight + tally.abstainWeight;
  const [turnoutText, quorumText] = formatWeightGroup([turnout, proposal.quorum]);
  const metQuorum = turnout >= proposal.quorum;

  return (
    <div className="table-scroll">
      <table>
        <caption className="label">What makes this tally checkable</caption>
        <tbody>
          <tr>
            <th scope="row">Voting window</th>
            <td className="mono">
              {proposal.startBlock.toString()} → {proposal.endBlock.toString()}
            </td>
            <td className="dim small">fixed at creation</td>
          </tr>
          <tr>
            <th scope="row">Counted through</th>
            <td className="mono">{countedThrough.toString()}</td>
            <td>
              <span className={pinned ? "badge badge-live" : "badge badge-danger"}>
                {pinned ? "equals end_block" : "DOES NOT MATCH end_block"}
              </span>
            </td>
          </tr>
          <tr>
            <th scope="row">Ballot set</th>
            <td className="mono">{shortHex(commitment, 10, 6)}</td>
            <td className="dim small">
              Poseidon, tagged <span className="mono">APERTURE_BALLOTS:V3</span>
            </td>
          </tr>
          <tr>
            <th scope="row">Turnout</th>
            <td className="mono">
              {turnoutText!.display} / {quorumText!.display}
            </td>
            <td>
              <span className={metQuorum ? "badge badge-live" : "badge badge-danger"}>
                {metQuorum ? "meets quorum" : "below quorum"}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="dim small">
        This page cannot check the sum. Counting requires the ballot
        identities&rsquo; viewing keys, which the tally operator holds — so a
        commitment makes a disagreement <em>locatable</em>, not provable, and
        only to someone holding those keys. To close the loop yourself:{" "}
        <span className="mono">node services/tally/src/verify-tally.ts{" "}
        {proposal.id.toString()}</span>
      </p>
    </div>
  );
}

export function Proposals() {
  const state = useChainRead(async () => {
    const [count, block] = await Promise.all([getProposalCount(), getBlockNumber()]);
    const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1));
    const items = await Promise.all(
      ids.map(async (id) => {
        const [proposal, tally, terms] = await Promise.all([
          getProposal(id),
          getTally(id),
          // Replaces the old has_passed read rather than adding one, and brings
          // the provenance with it.
          getPayoutTerms(id),
        ]);
        // Only a finalized proposal has a pin or a commitment, so an open one
        // costs no extra reads.
        const [countedThrough, commitment] = proposal.finalized
          ? await Promise.all([getCountedThrough(id), getBallotCommitment(id)])
          : [0n, "0x0"];
        return { proposal, tally, terms, countedThrough, commitment };
      }),
    );
    return { items, head: block };
  }, []);

  if (state.status === "loading") {
    return (
      <section className="panel">
        <p className="dim" role="status" aria-live="polite">
          Reading {DEPLOYMENT.label}…
        </p>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="panel">
        <p className="bad" role="alert">
          Could not read the registry: {state.message}
        </p>
        <button type="button" className="cta" onClick={state.retry}>
          Try again
        </button>
      </section>
    );
  }

  const { items, head } = state.data;

  return (
    <>
      <section className="panel">
        <h2>Proposals on {DEPLOYMENT.label}</h2>
        <p className="lede">
          Read live from{" "}
          <a
            href={`${VOYAGER}/contract/${REGISTRY_ADDRESS}`}
            target="_blank"
            rel="noreferrer"
            className="mono"
          >
            {shortHex(REGISTRY_ADDRESS, 10, 6)}
          </a>{" "}
          at block {head.toLocaleString()}. No wallet needed.
        </p>

        {items.length === 0 ? (
          <p className="dim">
            No proposals yet. The registry is deployed and readable; the first
            proposal has not been created.
          </p>
        ) : (
          <ul className="proposals">
            {items.map(({ proposal, tally, terms, countedThrough, commitment }) => {
              const phase = phaseOf(proposal, BigInt(head));
              // The proposal's own quorum, read from the chain alongside it.
              // Predicting with a different rule than the contract uses is how
              // a page ends up disagreeing with the result it is displaying.
              const predicted = willPass(
                {
                  proposalId: proposal.id,
                  forWeight: tally.forWeight,
                  againstWeight: tally.againstWeight,
                  abstainWeight: tally.abstainWeight,
                  ballotCounts: { for: 0, against: 0, abstain: 0 },
                },
                proposal.quorum,
              );
              const disagrees = proposal.finalized && predicted !== terms.passed;

              return (
                <li key={proposal.id.toString()}>
                  <div className="proposal-line">
                    <strong>#{proposal.id.toString()}</strong>
                    <span className="uri">{decodeShortString(proposal.metadataUri)}</span>
                    <span
                      className={
                        phase === "open" && DEPLOYMENT.ballotIdentitiesLive
                          ? "tag open"
                          : "tag closed"
                      }
                    >
                      {phaseLabel(phase, proposal)}
                    </span>
                  </div>

                  {proposal.finalized ? (
                    <div className="tally">
                      {(() => {
                        const [f, a, ab] = formatWeightGroup([
                          tally.forWeight,
                          tally.againstWeight,
                          tally.abstainWeight,
                        ]);
                        return (
                          <>
                            <span>for {f!.display}</span>
                            <span>against {a!.display}</span>
                            <span>abstain {ab!.display}</span>
                          </>
                        );
                      })()}
                      <span className={terms.passed ? "ok" : "dim"}>
                        {terms.passed ? "passed" : "did not pass"}
                      </span>
                    </div>
                  ) : null}

                  {disagrees ? (
                    <p className="bad small" role="alert">
                      MISMATCH: this page computes {predicted ? "passed" : "did not pass"}{" "}
                      while the contract reports{" "}
                      {terms.passed ? "passed" : "did not pass"}. Trust the
                      contract and tell us.
                    </p>
                  ) : null}

                  <TallyProvenance proposal={proposal} tally={tally} terms={terms} />
                  <TallyVerification
                    proposal={proposal}
                    tally={tally}
                    countedThrough={countedThrough}
                    commitment={commitment}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <BallotIdentities proposalId={items.length > 0 ? items[0]!.proposal.id : 1n} />
    </>
  );
}
