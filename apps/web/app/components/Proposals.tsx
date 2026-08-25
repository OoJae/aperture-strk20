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
  hasPassed,
  shortHex,
} from "../lib/chain.ts";
import type { Proposal, Tally } from "../lib/chain.ts";
import { formatWeightGroup } from "../lib/format.ts";
import { useChainRead } from "../lib/useChainRead.ts";
import { BallotIdentities } from "./BallotIdentities.tsx";

interface Loaded {
  proposal: Proposal;
  tally: Tally;
  /** The contract's verdict, not ours. */
  passedOnChain: boolean;
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

function TallyProvenance({ proposal, tally }: { proposal: Proposal; tally: Tally }) {
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

  // The case the old `total === 0n` gate made unreachable, and the one that
  // most needed saying.
  if (!DEPLOYMENT.ballotIdentitiesLive) {
    return (
      <p className="disclosure small">
        <strong>This aggregate was entered by the tally operator, not counted
        from ballots.</strong>{" "}
        No ballot identity for this proposal is deployed on {DEPLOYMENT.label},
        so no note could ever have been sent to one. The units give it away:
        these are raw base units, around 10⁻¹⁶ STRK, not a staked weight. A
        passed proposal is a precondition for demonstrating a treasury payout at
        all, which is why it exists. No tally on this network has been produced
        by counted ballots. <a href="/proof">The record →</a>
      </p>
    );
  }

  return (
    <p className="dim small">
      Counted from notes discovered at this proposal&rsquo;s ballot identities.
    </p>
  );
}

export function Proposals() {
  const state = useChainRead(async () => {
    const [count, block] = await Promise.all([getProposalCount(), getBlockNumber()]);
    const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1));
    const items = await Promise.all(
      ids.map(async (id) => ({
        proposal: await getProposal(id),
        tally: await getTally(id),
        passedOnChain: await hasPassed(id),
      })),
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
            {items.map(({ proposal, tally, passedOnChain }) => {
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
              const disagrees = proposal.finalized && predicted !== passedOnChain;

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
                      <span className={passedOnChain ? "ok" : "dim"}>
                        {passedOnChain ? "passed" : "did not pass"}
                      </span>
                    </div>
                  ) : null}

                  {disagrees ? (
                    <p className="bad small" role="alert">
                      MISMATCH: this page computes {predicted ? "passed" : "did not pass"}{" "}
                      while the contract reports{" "}
                      {passedOnChain ? "passed" : "did not pass"}. Trust the
                      contract and tell us.
                    </p>
                  ) : null}

                  <TallyProvenance proposal={proposal} tally={tally} />
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
