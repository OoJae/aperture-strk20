/**
 * The worker had no RPC retry at all, and it cost a lifecycle rehearsal twice.
 *
 * Fifteen call sites each did `new RpcProvider({ nodeUrl })`, so one dropped
 * connection ended the run — `Error: fetch failed`, a stack trace, and whatever
 * it was part way through abandoned. Meanwhile `apps/web/app/lib/chain.ts` had
 * always fallen back across endpoints. The half that spends money was the half
 * without it.
 *
 * These tests pin the part that is easy to get wrong: retrying a transport
 * failure is safe, retrying an answer is not. A node that says "insufficient
 * balance" means it however many times it is asked, and asking again turns one
 * clear failure into a slow one.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { makeProvider } from "../src/provider.ts";

const OK = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/** A JSON-RPC reply for whatever starknet.js asked. */
const blockNumber = () => OK({ jsonrpc: "2.0", id: 1, result: 14384107 });

/** Swap global fetch for the duration of one call. */
async function withFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

describe("makeProvider", () => {
  it("retries a dropped connection and succeeds", async () => {
    let calls = 0;
    const flaky = (async () => {
      calls++;
      if (calls < 3) throw new TypeError("fetch failed");
      return blockNumber();
    }) as unknown as typeof fetch;

    const n = await withFetch(flaky, () =>
      makeProvider("https://primary.invalid").getBlockNumber(),
    );
    assert.equal(n, 14384107);
    assert.equal(calls, 3, "should have retried twice before succeeding");
  });

  it("retries a 503 from a gateway", async () => {
    let calls = 0;
    const flaky = (async () => {
      calls++;
      return calls < 2 ? new Response("busy", { status: 503 }) : blockNumber();
    }) as unknown as typeof fetch;

    await withFetch(flaky, () => makeProvider("https://primary.invalid").getBlockNumber());
    assert.equal(calls, 2);
  });

  it("does NOT retry an RPC error, which is an answer", async () => {
    // The node replies 200 with a JSON error body. Asking again cannot change it.
    let calls = 0;
    const rejects = (async () => {
      calls++;
      return OK({
        jsonrpc: "2.0",
        id: 1,
        error: { code: 55, message: "Account validation failed" },
      });
    }) as unknown as typeof fetch;

    await withFetch(rejects, async () => {
      await assert.rejects(() => makeProvider("https://primary.invalid").getBlockNumber());
    });
    assert.equal(calls, 1, "an RPC error must be surfaced immediately, not retried");
  });

  it("falls through to a later endpoint when the first is dead", async () => {
    const seen: string[] = [];
    const impl = (async (input: unknown) => {
      const url = String(input instanceof Request ? input.url : input);
      seen.push(url);
      if (url.includes("dead")) throw new TypeError("fetch failed");
      return blockNumber();
    }) as unknown as typeof fetch;

    const n = await withFetch(impl, () =>
      makeProvider("https://dead.invalid", ["https://live.invalid"]).getBlockNumber(),
    );
    assert.equal(n, 14384107);
    assert.ok(
      seen.some((u) => u.includes("live")),
      "should have tried the fallback endpoint",
    );
  });

  it("gives up with an error naming how much it tried", async () => {
    const dead = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    await withFetch(dead, async () => {
      await assert.rejects(
        () => makeProvider("https://a.invalid", ["https://b.invalid"]).getBlockNumber(),
        (error: Error) => {
          assert.match(error.message, /RPC endpoint/);
          return true;
        },
      );
    });
  });

  it("does not treat a fallback identical to the primary as a second chance", async () => {
    const seen: string[] = [];
    const impl = (async (input: unknown) => {
      seen.push(String(input instanceof Request ? input.url : input));
      return blockNumber();
    }) as unknown as typeof fetch;

    await withFetch(impl, () =>
      makeProvider("https://same.invalid", ["https://same.invalid"]).getBlockNumber(),
    );
    assert.equal(seen.length, 1);
  });
});
