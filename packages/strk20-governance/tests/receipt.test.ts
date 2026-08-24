/**
 * What counts as "ran through Aperture's own code".
 *
 * The scoring rule this repository states is stricter than the organisers'
 * checker: theirs wants a pool event, ours wants an event from a contract we
 * wrote. That makes the classifier the thing standing between an honest claim
 * and an inflated one, in both directions.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyReceipt } from "../src/receipt.ts";
test("an event from a superseded contract still counts as ours", () => {
  // Repointing the active deployment to v2 reclassified six of ten historical
  // mainnet transactions from "scores" to "counts for nothing", with nothing on
  // the chain having changed. A transaction that ran through the v1 anonymizer
  // ran through a contract we wrote, and it does not stop having done so
  // because a v2 was deployed afterwards.
  const context = {
    pool: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
    registry: "0x02994d8a2b9a78d7c6c3d49696a22ec2010ffa120da09481ed1e5065e770e989",
    anonymizer: "0x01379a8daf18dfbb24b6ec80feb846b6445692090ab34ba0b286d49d1c04e1c5",
    superseded: [
      {
        address: "0x05cc31d13d5901347d009f70f59abacb22b76e84963286004b67bf4644546890",
        kind: "anonymizer" as const,
      },
    ],
  };
  const receipt = {
    execution_status: "SUCCEEDED",
    events: [
      { from_address: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a" },
      // Unpadded, as an explorer would write it — the numeric compare matters.
      { from_address: "0x5cc31d13d5901347d009f70f59abacb22b76e84963286004b67bf4644546890" },
    ],
  };

  const verdict = classifyReceipt(receipt, context);
  assert.equal(verdict.scores, true, "a v1 anonymizer event must still score");
  assert.equal(verdict.ourEvents.length, 1);
  assert.equal(verdict.ourEvents[0]?.role, "anonymizer");
});

test("a stranger's contract never counts as ours", () => {
  const verdict = classifyReceipt(
    {
      execution_status: "SUCCEEDED",
      events: [{ from_address: "0x0badc0ffee" }],
    },
    {
      pool: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
      registry: "0x02994d8a2b9a78d7c6c3d49696a22ec2010ffa120da09481ed1e5065e770e989",
      anonymizer: "0x01379a8daf18dfbb24b6ec80feb846b6445692090ab34ba0b286d49d1c04e1c5",
      superseded: [{ address: "0x05cc31d1", kind: "anonymizer" as const }],
    },
  );
  assert.equal(verdict.scores, false);
  assert.equal(verdict.passesOrganizerCheck, false);
});
