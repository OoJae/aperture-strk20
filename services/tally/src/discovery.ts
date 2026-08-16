/**
 * Reading the notes sent to a ballot identity.
 *
 * Two properties of the discovery service shape this file, both from the SDK's
 * own source and specs:
 *
 * 1. **`discoverNotes` returns only unspent notes**, silently omitting spent
 *    ones. For a balance that is the right behaviour; for a tally it is a
 *    correctness bug waiting to happen, because a ballot identity that ever
 *    moved a received note would have that vote vanish from the count. So we
 *    read received-transfer history instead of the unspent set.
 * 2. **Enumeration must be pinned to a block hash.** Only hash mode gives
 *    consistency across paginated reads and reorg detection; against a moving
 *    tag the set can shift mid-count. A reorg surfaces as HTTP 409, and the
 *    documented response is to re-sync from scratch rather than reconcile.
 *
 * Discovery is a pure query — no proof, no fee, no transaction. It needs the
 * indexer and never the prover, which is the only reason a tally is buildable
 * while proving infrastructure remains unpublished.
 */

import type { BallotIdentity, BallotNote } from "@aperture/strk20-governance";

/** Raised when the pinned block is reorged out from under an enumeration. */
export class ReorgedError extends Error {
  constructor(blockRef: string) {
    super(`Block ${blockRef} was reorged out; re-run the tally from scratch`);
    this.name = "ReorgedError";
  }
}

export interface DiscoveryOptions {
  indexerUrl: string;
  poolAddress: string;
  /**
   * Block hash every read is pinned to. Callers should choose one comfortably
   * behind the head so the count is reproducible by anyone re-running it.
   */
  blockHash: string;
}

interface HistoryTransfer {
  action?: string;
  note_id?: string;
  amount?: string;
}

interface HistoryTransaction {
  notes?: HistoryTransfer[];
}

interface HistoryResponse {
  transactions?: HistoryTransaction[];
  cursor?: unknown;
  history_complete?: boolean;
}

const HISTORY_PATH = "/v1/history";
const REORG_STATUS = 409;
/** Server caps this at 100; ask for the maximum to reduce round trips. */
const PAGE_SIZE = 100;

async function postHistory(
  options: DiscoveryOptions,
  identityAddress: string,
  viewingKey: bigint,
  cursor: unknown,
): Promise<HistoryResponse> {
  const response = await fetch(new URL(HISTORY_PATH, options.indexerUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contract_address: options.poolAddress,
      user_address: identityAddress,
      viewing_key: `0x${viewingKey.toString(16)}`,
      max_transactions: PAGE_SIZE,
      // block_ref and last_known_block are mutually exclusive. Pinning wins:
      // a block hash that has been reorged out stops resolving, so consistency
      // and reorg detection come from the same field.
      block_ref: options.blockHash,
      cursor,
    }),
  });

  if (response.status === REORG_STATUS) throw new ReorgedError(options.blockHash);
  if (!response.ok) {
    throw new Error(
      `Discovery failed (${response.status}): ${await response.text()}`,
    );
  }
  return (await response.json()) as HistoryResponse;
}

/**
 * Every note this identity has received, spent or not.
 *
 * Paginates to completion. Deduplication is left to `aggregateNotes`, which
 * dedupes by note id anyway — doing it in one place means a page boundary
 * cannot double-count a vote.
 */
export async function discoverReceivedNotes(
  identity: BallotIdentity,
  viewingKey: bigint,
  options: DiscoveryOptions,
): Promise<BallotNote[]> {
  const notes: BallotNote[] = [];
  let cursor: unknown = undefined;

  for (;;) {
    const page = await postHistory(options, identity.address, viewingKey, cursor);

    for (const transaction of page.transactions ?? []) {
      for (const entry of transaction.notes ?? []) {
        if (entry.action !== "transferReceived") continue;
        if (!entry.note_id || entry.amount === undefined) continue;
        notes.push({ id: entry.note_id, amount: BigInt(entry.amount) });
      }
    }

    if (page.history_complete !== false || !page.cursor) break;
    cursor = page.cursor;
  }

  return notes;
}

/** Whether the configured indexer is up, before doing anything slower. */
export async function checkIndexerHealth(
  indexerUrl: string,
): Promise<{ healthy: boolean; head?: number; lagSeconds?: number }> {
  try {
    const response = await fetch(new URL("/health", indexerUrl));
    if (!response.ok) return { healthy: false };
    const body = (await response.json()) as {
      status?: string;
      chain_head?: { block_number?: number };
      lag_secs?: number;
    };
    return {
      healthy: body.status === "OK",
      head: body.chain_head?.block_number,
      lagSeconds: body.lag_secs,
    };
  } catch {
    return { healthy: false };
  }
}
