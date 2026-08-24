/**
 * A refund queue never shrinks, so "owed" has to mean something narrower.
 *
 * The queue is derived from a count pinned to the window's close, and that pin
 * is permanent — a ballot stays in the queue after its stake is back with the
 * voter. Reporting the whole queue as owed would be false within a day of being
 * true, which is this repository's characteristic bug.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { refundStatus, isRefunded, refundReceiptPath } from "../src/refund-receipts.ts";
import type { RefundQueue } from "../src/refunds.ts";

const entry = (noteId: string, amount: bigint) => ({
  choice: "for" as const,
  noteId,
  amount,
  from: "0x1",
  payee: "0x2",
});

function withTempDir<T>(fn: () => T): T {
  const dir = mkdtempSync(resolve(tmpdir(), "aperture-refunds-"));
  const previous = process.env.APERTURE_REFUND_DIR;
  process.env.APERTURE_REFUND_DIR = dir;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.APERTURE_REFUND_DIR;
    else process.env.APERTURE_REFUND_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

const queue: RefundQueue = {
  proposalId: 1n,
  entries: [entry("0xaaa1", 5n * 10n ** 18n), entry("0xbbb2", 3n * 10n ** 18n)],
  totalAmount: 8n * 10n ** 18n,
};

test("with no receipts, everything is outstanding", () => {
  withTempDir(() => {
    const s = refundStatus("sepolia", queue);
    assert.equal(s.outstanding.length, 2);
    assert.equal(s.settled.length, 0);
    assert.equal(s.outstandingAmount, 8n * 10n ** 18n);
    assert.equal(s.settledAmount, 0n);
  });
});

test("a receipt moves one ballot from owed to returned", () => {
  withTempDir(() => {
    const path = refundReceiptPath("sepolia", queue.entries[0]!);
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(path, "{}");

    const s = refundStatus("sepolia", queue);
    assert.equal(s.settled.length, 1);
    assert.equal(s.settled[0]?.noteId, "0xaaa1");
    assert.equal(s.settledAmount, 5n * 10n ** 18n);
    assert.equal(s.outstandingAmount, 3n * 10n ** 18n);
  });
});

test("receipts are scoped per network", () => {
  // The same note id can exist on both networks. A Sepolia rehearsal must not
  // make a mainnet stake look already returned.
  withTempDir(() => {
    const path = refundReceiptPath("sepolia", queue.entries[0]!);
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(path, "{}");

    assert.equal(isRefunded("sepolia", queue.entries[0]!), true);
    assert.equal(isRefunded("mainnet", queue.entries[0]!), false);
  });
});
