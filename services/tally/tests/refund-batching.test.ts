/**
 * Batching is an economic claim, so it is tested as arithmetic.
 *
 * A pool transaction costs a flat fee — 6 STRK on mainnet, 2 on Sepolia, read
 * from the pool rather than assumed. Refunding one note per transaction meant a
 * 5 STRK ballot cost 6 STRK to return, which is why `--force-uneconomic` had to
 * exist. The fix is to spend once per ballot identity rather than once per note.
 *
 * The number that matters is how many transactions a queue collapses to, and it
 * is not one. A pool transaction is scoped to one signing account and one
 * viewing key; ballot identities are derived per choice; no account can sign for
 * another. So the floor is the number of choices that actually received stake —
 * at most three. Six places in this repository claimed "one pool transaction"
 * before this file existed to contradict them.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CHOICES } from "@oojae/strk20-governance";
import type { Choice } from "@oojae/strk20-governance";

import { buildRefundQueue, groupRefundsByIdentity } from "../src/refunds.ts";
import type { RefundEntry } from "../src/refunds.ts";

const STRK = 10n ** 18n;

/** Ballot identities are per choice, so the address stands in for the choice. */
const ADDRESS: Record<Choice, string> = {
  for: "0xfa",
  against: "0xa9",
  abstain: "0xab",
};

const ballot = (choice: Choice, noteId: string, strk: bigint, payee = "0xvoter"): RefundEntry => ({
  choice,
  noteId,
  amount: strk * STRK,
  from: ADDRESS[choice],
  payee,
});

/** What the queue would have cost before batching: one flat fee per note. */
const unbatchedCost = (entries: readonly RefundEntry[], fee: bigint) =>
  BigInt(entries.length) * fee;

const batchedCost = (entries: readonly RefundEntry[], fee: bigint) =>
  BigInt(groupRefundsByIdentity(entries).length) * fee;

describe("groupRefundsByIdentity", () => {
  it("collapses many notes at one identity into a single transaction", () => {
    const entries = [
      ballot("for", "0x1", 5n, "0xalice"),
      ballot("for", "0x2", 5n, "0xbob"),
      ballot("for", "0x3", 5n, "0xcarol"),
    ];
    const groups = groupRefundsByIdentity(entries);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.entries.length, 3);
    assert.equal(groups[0]!.totalAmount, 15n * STRK);
  });

  it("never merges across choices, because no account can sign for another", () => {
    const entries = [
      ballot("for", "0x1", 5n),
      ballot("against", "0x2", 5n),
      ballot("abstain", "0x3", 5n),
    ];
    const groups = groupRefundsByIdentity(entries);
    assert.equal(groups.length, 3);
    assert.deepEqual(
      groups.map((g) => g.from),
      [ADDRESS.for, ADDRESS.against, ADDRESS.abstain],
    );
  });

  it("bounds a proposal at three transactions however many ballots it has", () => {
    // Thirty ballots spread over the three choices.
    const entries = Array.from({ length: 30 }, (_, i) =>
      ballot(CHOICES[i % 3]!, `0x${i}`, 5n, `0xvoter${i}`),
    );
    const groups = groupRefundsByIdentity(entries);
    assert.equal(groups.length, CHOICES.length);
    assert.equal(
      groups.reduce((n, g) => n + g.entries.length, 0),
      30,
      "every ballot must appear in exactly one group",
    );
  });

  it("is deterministic in choice order, not discovery order", () => {
    const a = groupRefundsByIdentity([
      ballot("abstain", "0x1", 1n),
      ballot("for", "0x2", 1n),
      ballot("against", "0x3", 1n),
    ]);
    const b = groupRefundsByIdentity([
      ballot("against", "0x3", 1n),
      ballot("abstain", "0x1", 1n),
      ballot("for", "0x2", 1n),
    ]);
    assert.deepEqual(a.map((g) => g.choice), b.map((g) => g.choice));
    assert.deepEqual(a.map((g) => g.choice), ["for", "against", "abstain"]);
  });

  it("preserves entry order inside a group", () => {
    const entries = [
      ballot("for", "0xfirst", 1n),
      ballot("for", "0xsecond", 1n),
      ballot("for", "0xthird", 1n),
    ];
    assert.deepEqual(
      groupRefundsByIdentity(entries)[0]!.entries.map((e) => e.noteId),
      ["0xfirst", "0xsecond", "0xthird"],
    );
  });

  it("a group of one behaves exactly as the unbatched path did", () => {
    const only = ballot("for", "0x1", 5n, "0xalice");
    const groups = groupRefundsByIdentity([only]);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0]!.entries, [only]);
    assert.equal(groups[0]!.totalAmount, only.amount);
  });

  it("returns nothing for an empty queue rather than a group of nothing", () => {
    assert.deepEqual(groupRefundsByIdentity([]), []);
  });

  it("loses no stake: group totals sum to the queue total", () => {
    const entries = Array.from({ length: 12 }, (_, i) =>
      ballot(CHOICES[i % 3]!, `0x${i}`, BigInt(i + 1), `0xvoter${i}`),
    );
    const queueTotal = entries.reduce((sum, e) => sum + e.amount, 0n);
    const grouped = groupRefundsByIdentity(entries).reduce((s, g) => s + g.totalAmount, 0n);
    assert.equal(grouped, queueTotal);
  });
});

describe("the economics batching exists to fix", () => {
  const MAINNET_FEE = 6n * STRK;

  it("turns a loss into a gain for three same-choice ballots", () => {
    // The case that motivated this: 5 STRK ballots against a 6 STRK flat fee.
    const entries = [
      ballot("for", "0x1", 5n, "0xalice"),
      ballot("for", "0x2", 5n, "0xbob"),
      ballot("for", "0x3", 5n, "0xcarol"),
    ];
    const returned = entries.reduce((s, e) => s + e.amount, 0n);

    assert.equal(unbatchedCost(entries, MAINNET_FEE), 18n * STRK);
    assert.ok(unbatchedCost(entries, MAINNET_FEE) > returned, "unbatched destroyed value");

    assert.equal(batchedCost(entries, MAINNET_FEE), 6n * STRK);
    assert.ok(batchedCost(entries, MAINNET_FEE) < returned, "batched returns more than it costs");
  });

  it("cannot help a single ballot, and the test says so rather than pretending", () => {
    // Honest limit: one note at one identity is one transaction either way. A
    // 5 STRK ballot on mainnet still costs 6 STRK to return.
    const entries = [ballot("for", "0x1", 5n)];
    assert.equal(batchedCost(entries, MAINNET_FEE), unbatchedCost(entries, MAINNET_FEE));
    assert.ok(batchedCost(entries, MAINNET_FEE) > entries[0]!.amount);
  });

  it("saves one flat fee per note beyond the first at each identity", () => {
    const entries = Array.from({ length: 30 }, (_, i) =>
      ballot(CHOICES[i % 3]!, `0x${i}`, 5n, `0xvoter${i}`),
    );
    const saved = unbatchedCost(entries, MAINNET_FEE) - batchedCost(entries, MAINNET_FEE);
    // 30 transactions become 3.
    assert.equal(saved, 27n * MAINNET_FEE);
  });
});

describe("grouping composes with the queue builder", () => {
  it("groups a queue built from discovered notes", () => {
    const queue = buildRefundQueue(1n, [
      {
        identity: { choice: "for", address: ADDRESS.for },
        notes: [
          { id: "0x1", amount: 5n * STRK, payee: "0xalice" },
          { id: "0x2", amount: 5n * STRK, payee: "0xbob" },
        ],
      },
      {
        identity: { choice: "against", address: ADDRESS.against },
        notes: [{ id: "0x3", amount: 5n * STRK, payee: "0xcarol" }],
      },
    ] as never);

    assert.equal(queue.entries.length, 3);
    const groups = groupRefundsByIdentity(queue.entries);
    assert.equal(groups.length, 2);
    assert.equal(
      groups.reduce((s, g) => s + g.totalAmount, 0n),
      queue.totalAmount,
    );
  });
});
