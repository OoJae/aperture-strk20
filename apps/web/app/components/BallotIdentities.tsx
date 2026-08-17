"use client";

/**
 * The verification panel — the point of the whole design.
 *
 * A voter is about to send money to an address an interface handed them. They
 * should not have to take that address on faith. So the browser derives it
 * independently from public inputs and shows it beside what the contract
 * publishes. If the two ever disagree, the interface is lying and the mismatch
 * is visible rather than silent.
 */

import { useEffect, useState } from "react";
import { CHOICES, deriveBallotIdentity } from "@aperture/strk20-governance";
import type { Choice } from "@aperture/strk20-governance";
import {
  BALLOT_CONFIG,
  VOYAGER,
  getBallotAddressOnChain,
  shortHex,
} from "../lib/chain.ts";

const CHOICE_INDEX: Record<Choice, number> = { for: 0, against: 1, abstain: 2 };

interface Row {
  choice: Choice;
  derived: string;
  onChain?: string;
  matches?: boolean;
}

export function BallotIdentities({ proposalId }: { proposalId: bigint }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;

    // Derive locally first so the panel is useful even if the RPC is slow.
    const derivedRows: Row[] = CHOICES.map((choice) => ({
      choice,
      derived: deriveBallotIdentity(proposalId, choice, BALLOT_CONFIG).address,
    }));
    setRows(derivedRows);

    (async () => {
      try {
        const confirmed = await Promise.all(
          derivedRows.map(async (row) => {
            const onChain = await getBallotAddressOnChain(
              proposalId,
              CHOICE_INDEX[row.choice],
            );
            return {
              ...row,
              onChain,
              matches: BigInt(onChain) === BigInt(row.derived),
            };
          }),
        );
        if (!cancelled) setRows(confirmed);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "could not reach the registry");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [proposalId]);

  return (
    <section className="panel">
      <h2>Where a vote goes</h2>
      <p className="lede">
        Each choice has its own receiving identity. Your browser derives these
        addresses from public inputs and compares them against what the contract
        publishes — so you can check this page rather than trust it.
      </p>

      <table>
        <thead>
          <tr>
            <th>Choice</th>
            <th>Derived in your browser</th>
            <th>Published by the contract</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.choice}>
              <td className="choice">{row.choice}</td>
              <td className="mono">{shortHex(row.derived, 10, 6)}</td>
              <td className="mono">
                {row.onChain ? (
                  <a
                    href={`${VOYAGER}/contract/${row.onChain}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortHex(row.onChain, 10, 6)}
                  </a>
                ) : (
                  <span className="dim">reading…</span>
                )}
              </td>
              <td>
                {row.matches === undefined ? null : row.matches ? (
                  <span className="ok">match</span>
                ) : (
                  <span className="bad">MISMATCH</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {error ? <p className="bad">Could not reach the registry: {error}</p> : null}
    </section>
  );
}
