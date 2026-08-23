import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DiscoveryPageLimitError,
  DiscoveryStalledError,
  MissingNotePayeeError,
  ReorgedError,
  UnexpectedCursorShapeError,
  discoverReceivedNotes,
} from "../src/discovery.ts";
import { startFakeIndexer } from "./helpers/fake-indexer.ts";

const TOKEN = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const OTHER_TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const PIN = "0x346f32a8652685faa51a688d1a22b0c43ed7892342b6e030f4575e2f6d092e0";

const IDENTITY = { proposalId: 1n, choice: "for" as const, address: "0xba110700" };
const BASE = {
  poolAddress: "0xp001",
  blockHash: PIN,
  token: TOKEN,
  startBlock: 100,
  endBlock: 900,
};

const note = (over: Record<string, unknown> = {}) => ({
  sender_addr: "0xv0ter",
  token: TOKEN,
  index: 0,
  salt: "0xfeed",
  note_id: "0xn1",
  amount: "5000000000000000000",
  block_number: 500,
  ...over,
});

/** The shape the live service actually returns. */
const INCOMPLETE = {
  channel_discovery_complete: true,
  channels: {
    "0xv0ter": {
      channel_key: "0xck",
      subchannel_discovery_complete: false,
      subchannels: { [TOKEN]: { note_discovery_complete: false, last_note_index: 0 } },
    },
  },
};
const COMPLETE = {
  channel_discovery_complete: true,
  channels: {
    "0xv0ter": {
      channel_key: "0xck",
      subchannel_discovery_complete: true,
      subchannels: { [TOKEN]: { note_discovery_complete: true, last_note_index: 1 } },
    },
  },
};

const onePage = (notes: unknown[]) => [{ block_ref: PIN, notes, cursor: COMPLETE }];

describe("pagination", () => {
  it("follows the cursor to the second page", async () => {
    // THE REGRESSION TEST. Against the old code this returns one note and
    // issues one request: `history_complete` is not a field of this endpoint's
    // cursor, so `undefined !== false` broke the loop immediately.
    const idx = await startFakeIndexer([
      { block_ref: PIN, notes: [note({ note_id: "0xn1" })], cursor: INCOMPLETE },
      { block_ref: PIN, notes: [note({ note_id: "0xn2", index: 1 })], cursor: COMPLETE },
    ]);
    try {
      const notes = await discoverReceivedNotes(IDENTITY, 42n, { ...BASE, indexerUrl: idx.url });
      assert.deepEqual(notes.map((n) => n.id), ["0xn1", "0xn2"]);
      assert.equal(idx.requests.length, 2);
      assert.deepEqual(idx.requests[1]!.body.cursor, INCOMPLETE, "page two must carry page one's cursor");
      for (const r of idx.requests) {
        assert.equal(r.body.block_ref, PIN, "every page stays pinned to one block");
      }
    } finally {
      await idx.close();
    }
  });

  it("refuses an unrecognised cursor instead of truncating", async () => {
    // The exact shape the old code believed in.
    const idx = await startFakeIndexer([
      { block_ref: PIN, notes: [], cursor: { history_complete: true } },
    ]);
    await assert.rejects(
      () => discoverReceivedNotes(IDENTITY, 42n, { ...BASE, indexerUrl: idx.url }),
      UnexpectedCursorShapeError,
    );
    await idx.close();
  });

  it("terminates when the cursor stops advancing", async () => {
    const idx = await startFakeIndexer([{ block_ref: PIN, notes: [], cursor: INCOMPLETE }]);
    await assert.rejects(
      () => discoverReceivedNotes(IDENTITY, 42n, { ...BASE, indexerUrl: idx.url, maxPages: 5 }),
      (e: unknown) => e instanceof DiscoveryStalledError || e instanceof DiscoveryPageLimitError,
    );
    await idx.close();
  });

  it("raises ReorgedError on 409", async () => {
    const idx = await startFakeIndexer([], { status: 409 });
    await assert.rejects(
      () => discoverReceivedNotes(IDENTITY, 42n, { ...BASE, indexerUrl: idx.url }),
      ReorgedError,
    );
    await idx.close();
  });

  it("raises ReorgedError if the service answers about a different block", async () => {
    const idx = await startFakeIndexer([{ block_ref: "0xdeadbeef", notes: [], cursor: COMPLETE }]);
    await assert.rejects(
      () => discoverReceivedNotes(IDENTITY, 42n, { ...BASE, indexerUrl: idx.url }),
      ReorgedError,
    );
    await idx.close();
  });
});

describe("what counts as a ballot", () => {
  it("excludes a note in another token", async () => {
    // Without this filter a self-minted ERC-20 buys unlimited vote weight.
    const idx = await startFakeIndexer(
      onePage([note({ note_id: "0xgood" }), note({ note_id: "0xbad", token: OTHER_TOKEN })]),
    );
    const notes = await discoverReceivedNotes(IDENTITY, 42n, { ...BASE, indexerUrl: idx.url });
    assert.deepEqual(notes.map((n) => n.id), ["0xgood"]);
    await idx.close();
  });

  it("excludes notes outside the voting window", async () => {
    const idx = await startFakeIndexer(
      onePage([
        note({ note_id: "0xearly", block_number: 99 }),
        note({ note_id: "0xin", block_number: 500 }),
        note({ note_id: "0xlate", block_number: 901 }),
      ]),
    );
    const notes = await discoverReceivedNotes(IDENTITY, 42n, { ...BASE, indexerUrl: idx.url });
    assert.deepEqual(notes.map((n) => n.id), ["0xin"]);
    await idx.close();
  });

  it("counts a note exactly on each window boundary", async () => {
    const idx = await startFakeIndexer(
      onePage([
        note({ note_id: "0xopen", block_number: 100 }),
        note({ note_id: "0xclose", block_number: 900 }),
      ]),
    );
    const notes = await discoverReceivedNotes(IDENTITY, 42n, { ...BASE, indexerUrl: idx.url });
    assert.deepEqual(notes.map((n) => n.id), ["0xopen", "0xclose"]);
    await idx.close();
  });

  it("excludes open notes, which are public credits rather than ballots", async () => {
    const idx = await startFakeIndexer(onePage([note({ note_id: "0xopen", salt: "1" })]));
    const notes = await discoverReceivedNotes(IDENTITY, 42n, { ...BASE, indexerUrl: idx.url });
    assert.equal(notes.length, 0);
    await idx.close();
  });

  it("carries the payee, so a refund has somewhere to go", async () => {
    const idx = await startFakeIndexer(onePage([note({ sender_addr: "0xspecificvoter" })]));
    const [n] = await discoverReceivedNotes(IDENTITY, 42n, { ...BASE, indexerUrl: idx.url });
    assert.equal(n!.payee, "0xspecificvoter");
    await idx.close();
  });

  it("refuses a note with no sender rather than recording an unpayable one", async () => {
    const idx = await startFakeIndexer(onePage([note({ sender_addr: undefined })]));
    await assert.rejects(
      () => discoverReceivedNotes(IDENTITY, 42n, { ...BASE, indexerUrl: idx.url }),
      MissingNotePayeeError,
    );
    await idx.close();
  });
});
