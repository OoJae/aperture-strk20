/**
 * An RpcProvider that survives a flaky endpoint.
 *
 * The worker used to construct `new RpcProvider({ nodeUrl })` in fifteen places
 * with no retry anywhere, so a single dropped connection killed a run outright —
 * `Error: fetch failed`, a Node stack trace, and whatever the run was part way
 * through abandoned. That happened twice inside one lifecycle rehearsal on a
 * public Sepolia endpoint, once mid-count and once on the way to publishing a
 * tally.
 *
 * The web app has always been careful here: `apps/web/app/lib/chain.ts` falls
 * back across `DEPLOYMENT.rpcUrls` and gives up with a typed error. The worker,
 * which spends money and holds keys, was the half without it.
 *
 * Retries are deliberately narrow. A transport failure — the connection dropped,
 * the gateway returned 502/503/504 — is worth trying again, because nothing was
 * decided. An RPC error is not: the node answers 200 with a JSON error body, and
 * "insufficient balance" or "invalid transaction nonce" mean the same thing
 * however many times they are asked. Retrying those would turn one clear failure
 * into a slow one.
 *
 * Idempotence: `baseFetch` sits under both reads and writes, and retrying a
 * submitted transaction could in principle send it twice. It cannot here — a
 * Starknet invoke carries a nonce, so a duplicate is rejected rather than
 * executed, and a transport failure means the request did not complete anyway.
 */

import { RpcProvider } from "starknet";

/** Status codes worth asking again about. Everything else is an answer. */
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

const ATTEMPTS = 4;
const BACKOFF_MS = [400, 1200, 2500];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Build a provider whose transport retries transient failures.
 *
 * `fallbacks` are tried in order once the primary has exhausted its attempts,
 * which is what makes a public endpoint usable at all.
 */
export function makeProvider(nodeUrl: string, fallbacks: readonly string[] = []): RpcProvider {
  const urls = [nodeUrl, ...fallbacks.filter((u) => u && u !== nodeUrl)];

  const baseFetch: typeof fetch = async (input, init) => {
    let lastError: unknown;

    for (const url of urls) {
      // starknet.js passes the configured nodeUrl through; point it at whichever
      // endpoint this pass is using.
      const target =
        typeof input === "string" || input instanceof URL ? url : new Request(url, input as never);

      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        try {
          const response = await fetch(target as never, init);
          if (!RETRYABLE_STATUS.has(response.status)) return response;
          lastError = new Error(`HTTP ${response.status} from ${url}`);
        } catch (error) {
          // Transport failed: nothing was decided, so asking again is safe.
          lastError = error;
        }
        if (attempt < ATTEMPTS - 1) await sleep(BACKOFF_MS[attempt] ?? 2500);
      }
    }

    throw lastError instanceof Error
      ? new Error(
          `All ${urls.length} RPC endpoint(s) failed after ${ATTEMPTS} attempts each. ` +
            `Last error: ${lastError.message}`,
        )
      : new Error(`All ${urls.length} RPC endpoint(s) failed.`);
  };

  return new RpcProvider({ nodeUrl, baseFetch });
}
