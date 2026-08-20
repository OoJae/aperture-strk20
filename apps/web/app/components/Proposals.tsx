"use client";

/**
 * Live proposal state, read straight from the mainnet registry.
 *
 * No wallet, no connection, no account. Someone opening this page for the first
 * time sees real contract state immediately.
 */

import { useEffect, useState } from "react";
import { willPass } from "@aperture/strk20-governance";
import {
  REGISTRY_ADDRESS,
  VOYAGER,
  decodeShortString,
  getBlockNumber,
  getProposal,
  getProposalCount,
  getTally,
  shortHex,
} from "../lib/chain.ts";
import type { Proposal, Tally } from "../lib/chain.ts";
import { BallotIdentities } from "./BallotIdentities.tsx";

interface Loaded {
  proposal: Proposal;
  tally: Tally;
}

function formatStrk(amount: bigint): string {
  const whole = amount / 10n ** 18n;
  const frac = (amount % 10n ** 18n).toString().padStart(18, "0").slice(0, 2);
  return `${whole}.${frac}`;
}

export function Proposals() {
  const [items, setItems] = useState<Loaded[]>([]);
  const [head, setHead] = useState<number>();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [count, block] = await Promise.all([
          getProposalCount(),
          getBlockNumber(),
        ]);
        const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1));
        const loaded = await Promise.all(
          ids.map(async (id) => ({
            proposal: await getProposal(id),
            tally: await getTally(id),
          })),
        );
        if (cancelled) return;
        setHead(block);
        setItems(loaded);
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        setMessage(e instanceof Error ? e.message : "unknown error");
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "loading") {
    return <section className="panel"><p className="dim">Reading mainnet…</p></section>;
  }

  if (status === "error") {
    return (
      <section className="panel">
        <p className="bad">Could not read the registry: {message}</p>
      </section>
    );
  }

  return (
    <>
      <section className="panel">
        <h2>Proposals on mainnet</h2>
        <p className="lede">
          Read live from{" "}
          <a
            href={`${VOYAGER}/contract/${REGISTRY_ADDRESS}`}
            target="_blank"
            rel="noreferrer"
            className="mono"
          >
            {shortHex(REGISTRY_ADDRESS, 10, 6)}
          </a>
          {head ? ` at block ${head.toLocaleString()}` : null}. No wallet needed.
        </p>

        {items.length === 0 ? (
          <p className="dim">
            No proposals yet. The registry is deployed and readable; the first
            proposal has not been created.
          </p>
        ) : (
          <ul className="proposals">
            {items.map(({ proposal, tally }) => {
              const total =
                tally.forWeight + tally.againstWeight + tally.abstainWeight;
              const passed = willPass({
                proposalId: proposal.id,
                forWeight: tally.forWeight,
                againstWeight: tally.againstWeight,
                abstainWeight: tally.abstainWeight,
                ballotCounts: { for: 0, against: 0, abstain: 0 },
              });
              const open = head !== undefined && BigInt(head) <= proposal.endBlock;

              return (
                <li key={proposal.id.toString()}>
                  <div className="proposal-line">
                    <strong>#{proposal.id.toString()}</strong>
                    <span className="uri">
                      {decodeShortString(proposal.metadataUri)}
                    </span>
                    <span className={open ? "tag open" : "tag closed"}>
                      {open ? "voting open" : proposal.finalized ? "finalized" : "closed"}
                    </span>
                  </div>

                  {proposal.finalized ? (
                    <div className="tally">
                      <span>for {formatStrk(tally.forWeight)}</span>
                      <span>against {formatStrk(tally.againstWeight)}</span>
                      <span>abstain {formatStrk(tally.abstainWeight)}</span>
                      <span className={passed ? "ok" : "dim"}>
                        {passed ? "passed" : "did not pass"}
                      </span>
                    </div>
                  ) : (
                    <div className="tally dim">
                      No tally published. While voting is open there is nothing
                      to count from the outside — that is the point.
                    </div>
                  )}

                  {total === 0n && proposal.finalized ? (
                    <p className="dim small">
                      Finalized with a zero tally: the aggregate was published,
                      but no ballots had been cast.
                    </p>
                  ) : null}
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
