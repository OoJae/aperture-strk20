/**
 * Which refunds have already been paid.
 *
 * The queue is derived from the count, and the count is pinned forever, so a
 * ballot never leaves the queue — even after its stake is back with the voter.
 * Without this the tally would keep reporting stake as "owed" indefinitely,
 * which is the same species of stale claim as a doc that was true once.
 *
 * A receipt is written before the transfer is submitted, so its presence means
 * "this was attempted and the note may be spent", not "this definitely
 * settled". That is the safe direction: the alternative risks paying twice.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { RefundEntry, RefundQueue } from "./refunds.ts";

export const refundDir = (): string => process.env.APERTURE_REFUND_DIR ?? ".refunds";

export function refundReceiptPath(network: string, entry: RefundEntry): string {
  return resolve(refundDir(), `${network}-${entry.noteId.slice(0, 18)}.json`);
}

export function isRefunded(network: string, entry: RefundEntry): boolean {
  return existsSync(refundReceiptPath(network, entry));
}

export interface RefundStatus {
  outstanding: RefundEntry[];
  settled: RefundEntry[];
  outstandingAmount: bigint;
  settledAmount: bigint;
}

export function refundStatus(network: string, queue: RefundQueue): RefundStatus {
  const outstanding: RefundEntry[] = [];
  const settled: RefundEntry[] = [];
  let outstandingAmount = 0n;
  let settledAmount = 0n;
  for (const entry of queue.entries) {
    if (isRefunded(network, entry)) {
      settled.push(entry);
      settledAmount += entry.amount;
    } else {
      outstanding.push(entry);
      outstandingAmount += entry.amount;
    }
  }
  return { outstanding, settled, outstandingAmount, settledAmount };
}

/** The transaction hash a receipt records, if it recorded one. */
export function refundTxHash(network: string, entry: RefundEntry): string | undefined {
  const path = refundReceiptPath(network, entry);
  if (!existsSync(path)) return undefined;
  try {
    return (JSON.parse(readFileSync(path, "utf8")) as { txHash?: string }).txHash;
  } catch {
    return undefined;
  }
}
