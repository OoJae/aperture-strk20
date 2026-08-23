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
 * them and never spends from them during a vote. If that ever changes — and
 * refunds, when they exist, are exactly that — a spent ballot silently drops
 * out of the count. `docs/ARCHITECTURE.md` claimed the opposite for a while;
 * this module is the one that is right, because it is the one making the call.
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

import type { BallotIdentity, BallotNote } from "@oojae/strk20-governance";

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
  /** Only notes in this token are vote weight. */
  token: string;
  /** The proposal's window. A note outside it is not a ballot for it. */
  startBlock: number;
  endBlock: number;
  signal?: AbortSignal;
  maxPages?: number;
  requestTimeoutMs?: number;
}

/**
 * A note, with the fields a tally and a refund both need.
 *
 * The previous version kept `{ id, amount }` and discarded the rest, which is
 * why any ERC-20 counted as vote weight at 1:1, why notes outside the voting
 * window counted, and why the refund queue has no payee: `sender_addr` was
 * parsed into a type and then dropped on the floor.
 */
export interface DiscoveredNote extends BallotNote {
  /** The pool identity that sent it. Without this a refund has no destination. */
  payee: string;
  token: string;
  blockNumber: number;
}

interface IncomingNote {
  note_id?: string;
  amount?: string;
  /** Who sent it. Needed for a refund to have a payee at all. */
  sender_addr?: string;
  /** Which token. A note in anything else is not vote weight. */
  token?: string;
  /** Which block. A note outside the voting window is not a ballot. */
  block_number?: number;
  /** "1" marks an open note — a public credit, not a sealed ballot. */
  salt?: string;
}

interface ApiSubchannelCursor {
  note_discovery_complete?: boolean;
  last_note_index?: number;
}

interface ApiChannelCursor {
  channel_key?: string;
  subchannel_discovery_complete?: boolean;
  subchannels?: Record<string, ApiSubchannelCursor>;
}

/**
 * The cursor this endpoint actually returns.
 *
 * Verified against the live service on 2026-08-23:
 *
 *     {"channel_discovery_complete":true,"total_n_channels":0}
 *
 * There is no `history_complete` — that belongs to `/v1/sync/history`, a
 * different endpoint. The loop below used to test for it, so `undefined !==
 * false` was always true and every scan stopped after page one. A tally is an
 * election result; silently counting one page of it is the worst failure mode
 * in this repository.
 */
interface ApiDiscoveryCursor {
  channel_discovery_complete?: boolean;
  total_n_channels?: number;
  last_channel_index?: number;
  channels?: Record<string, ApiChannelCursor>;
}

interface IncomingStateResponse {
  notes?: IncomingNote[];
  cursor?: ApiDiscoveryCursor;
  block_ref?: string;
}

/** Raised rather than guessed at: an unrecognised cursor means silent truncation. */
export class UnexpectedCursorShapeError extends Error {
  constructor(keys: readonly string[]) {
    super(
      `The discovery cursor has none of the expected keys (got: ${keys.join(", ") || "none"}). ` +
        `This service targets channel_discovery_complete / channels / subchannels. ` +
        `Refusing to continue: an unrecognised cursor would silently truncate the count.`,
    );
    this.name = "UnexpectedCursorShapeError";
  }
}

/** The indexer kept saying "more" without advancing. */
export class DiscoveryStalledError extends Error {
  constructor(pages: number) {
    super(`Discovery cursor stopped advancing after ${pages} pages; refusing to loop forever.`);
    this.name = "DiscoveryStalledError";
  }
}

export class DiscoveryPageLimitError extends Error {
  constructor(limit: number) {
    super(`Discovery exceeded ${limit} pages; refusing to continue.`);
    this.name = "DiscoveryPageLimitError";
  }
}

/** A note has no sender, so a refund could never be addressed. */
export class MissingNotePayeeError extends Error {
  constructor(noteId: string) {
    super(`Note ${noteId} carries no sender_addr, so a refund for it could never be addressed.`);
    this.name = "MissingNotePayeeError";
  }
}

/**
 * Mirrors the SDK's DiscoveryCursor.is_complete(). Completion is not one flag:
 * channels, then each channel's subchannels, then each subchannel's notes.
 */
function isApiCursorComplete(cursor: ApiDiscoveryCursor): boolean {
  if (!cursor.channel_discovery_complete) return false;
  if (!cursor.channels) return true;
  return Object.values(cursor.channels).every(
    (channel) =>
      channel.subchannel_discovery_complete &&
      (!channel.subchannels ||
        Object.values(channel.subchannels).every((sub) => !!sub.note_discovery_complete)),
  );
}

const INCOMING_PATH = "/v1/sync/incoming_state";
const REORG_STATUS = 409;

async function postIncomingState(
  options: DiscoveryOptions,
  identityAddress: string,
  viewingKey: bigint,
  cursor: unknown,
): Promise<IncomingStateResponse> {
  const timeout = AbortSignal.timeout(options.requestTimeoutMs ?? 15_000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;

  const response = await fetch(new URL(INCOMING_PATH, options.indexerUrl), {
    method: "POST",
    signal,
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
  const page = (await response.json()) as IncomingStateResponse;
  // Stronger than the SDK, which pins from the first response only: if the
  // service answers about a different block mid-enumeration, the count is no
  // longer of one consistent state.
  if (page.block_ref && BigInt(page.block_ref) !== BigInt(options.blockHash)) {
    throw new ReorgedError(options.blockHash);
  }
  return page;
}

/**
 * The unspent notes this identity received, in this token, inside the window.
 *
 * The previous docstring said "spent or not", contradicting the module header
 * eighty lines above it. The header is right: this endpoint filters out spent
 * notes. Neither statement could be trusted by whoever next touched the loop,
 * which is how the loop stayed broken.
 *
 * Paginates to completion, and refuses to guess when it cannot tell whether it
 * is complete. Deduplication is left to the caller, which dedupes by note id
 * across all three identities at once.
 */
export async function discoverReceivedNotes(
  identity: BallotIdentity,
  viewingKey: bigint,
  options: DiscoveryOptions,
): Promise<DiscoveredNote[]> {
  const notes: DiscoveredNote[] = [];
  const maxPages = options.maxPages ?? 500;
  const tokenValue = BigInt(options.token);

  let cursor: ApiDiscoveryCursor = {};
  let previousCursor = "";
  let pages = 0;

  for (;;) {
    if (++pages > maxPages) throw new DiscoveryPageLimitError(maxPages);

    const page = await postIncomingState(options, identity.address, viewingKey, cursor);
    const next = page.cursor;

    // An unrecognised cursor is not an empty result. Testing for a field this
    // endpoint does not return is precisely how every scan silently stopped at
    // page one, and the count looked fine.
    if (
      next === undefined ||
      !(
        "channel_discovery_complete" in next ||
        "channels" in next ||
        "total_n_channels" in next
      )
    ) {
      throw new UnexpectedCursorShapeError(Object.keys(next ?? {}));
    }

    for (const note of page.notes ?? []) {
      if (!note.note_id || note.amount === undefined) continue;
      // An open note is a public credit, not a sealed ballot.
      if (note.salt === "1") continue;
      // Any ERC-20 used to count as STRK at 1:1, so a self-minted token bought
      // unlimited vote weight.
      if (note.token !== undefined && BigInt(note.token) !== tokenValue) continue;
      // A note that arrived outside the window is not a ballot for this vote.
      if (
        note.block_number !== undefined &&
        (note.block_number < options.startBlock || note.block_number > options.endBlock)
      ) {
        continue;
      }
      if (!note.sender_addr) throw new MissingNotePayeeError(note.note_id);

      notes.push({
        id: note.note_id,
        amount: BigInt(note.amount),
        payee: note.sender_addr,
        token: note.token ?? options.token,
        blockNumber: note.block_number ?? 0,
      });
    }

    if (isApiCursorComplete(next)) break;

    const serialized = JSON.stringify(next);
    if (serialized === previousCursor) throw new DiscoveryStalledError(pages);
    previousCursor = serialized;
    cursor = next;
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
