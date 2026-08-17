/**
 * Reading the notes sent to a ballot identity.
 *
 * This reads **incoming state**, which is the only view that shows notes an
 * identity *received*. The transaction-history endpoint is scoped to
 * transactions a user submitted, so a ballot identity sees its own registration
 * there and nothing else — a vote cast by someone else never appears. That
 * distinction cost a debugging cycle: the tally reported an empty ballot box
 * while the note sat happily on-chain.
 *
 * The known limitation of this view is that it returns **unspent** notes. That
 * is correct here because ballot identities only ever receive: the DAO controls
 * them and never spends from them during a vote. If that ever changes, a spent
 * ballot would silently drop out of the count.
 *
 * Enumeration is pinned to a block hash. Only hash mode gives consistency
 * across paginated reads and reorg detection; against a moving tag the set can
 * shift mid-count. A reorg surfaces as HTTP 409, and the documented response is
 * to re-sync from scratch rather than reconcile.
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

interface IncomingNote {
  note_id?: string;
  amount?: string;
  sender_addr?: string;
  token?: string;
  block_number?: number;
}

interface IncomingStateResponse {
  notes?: IncomingNote[];
  cursor?: { subchannels?: unknown[]; history_complete?: boolean };
}

const INCOMING_PATH = "/v1/sync/incoming_state";
const REORG_STATUS = 409;

async function postIncomingState(
  options: DiscoveryOptions,
  identityAddress: string,
  viewingKey: bigint,
  cursor: unknown,
): Promise<IncomingStateResponse> {
  const response = await fetch(new URL(INCOMING_PATH, options.indexerUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contract_address: options.poolAddress,
      recipient_address: identityAddress,
      viewing_key: `0x${viewingKey.toString(16)}`,
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
  return (await response.json()) as IncomingStateResponse;
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
    const page = await postIncomingState(
      options,
      identity.address,
      viewingKey,
      cursor,
    );

    for (const note of page.notes ?? []) {
      if (!note.note_id || note.amount === undefined) continue;
      notes.push({ id: note.note_id, amount: BigInt(note.amount) });
    }

    if (page.cursor?.history_complete !== false || !page.cursor) break;
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
