/**
 * A fake discovery service, serving canned pages.
 *
 * This is the harness whose absence let the pagination bug live: the loop tested
 * for `history_complete`, a field this endpoint does not return, so every scan
 * stopped after one page and every tally was silently truncated. Two pages and
 * one assertion would have caught it on the day it was written.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedRequest {
  path: string;
  body: Record<string, unknown>;
}

export interface FakeIndexer {
  url: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

export async function startFakeIndexer(
  pages: unknown[],
  options: { status?: number; body?: string } = {},
): Promise<FakeIndexer> {
  const requests: RecordedRequest[] = [];

  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "OK", chain_head: { block_number: 1000 }, lag_secs: 2 }));
        return;
      }

      requests.push({ path: req.url ?? "", body: raw ? JSON.parse(raw) : {} });

      if (options.status && options.status !== 200) {
        res.writeHead(options.status, { "content-type": "application/json" });
        res.end(options.body ?? "error");
        return;
      }

      // Repeat the last page once the script runs out, so a loop that refuses
      // to terminate is exercised rather than crashing the server.
      const page = pages[Math.min(requests.length - 1, pages.length - 1)];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(page));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
