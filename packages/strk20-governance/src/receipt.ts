/**
 * One place that decides whether a transaction counts.
 *
 * This repository carried two different answers to that question. The comment
 * in `scripts/record-tx.ts` said "emitted at least one event from the STRK20
 * pool"; `docs/DEPLOYMENTS.md` said "ran through one of the project's own
 * contracts"; and `scripts/verify-tx.ts` implemented the first while printing a
 * summary that assumed the second. That is how a manifest ends up describing
 * itself wrongly.
 *
 * Both rules are real and they are not the same rule, so both are computed and
 * reported side by side rather than one being quietly picked:
 *
 * - `passesOrganizerCheck` is what the sprint's checker actually applies.
 * - `scores` is the stricter claim this project makes about itself.
 *
 * Anything that reports a count says which rule it counted by.
 */

export interface RawReceipt {
  readonly execution_status?: string;
  readonly revert_reason?: string;
  readonly block_number?: number;
  readonly events?: readonly { readonly from_address: string }[];
}

export interface ReceiptContext {
  readonly pool: string;
  readonly registry: string;
  readonly anonymizer: string;
  /**
   * Earlier generations, which still count as Aperture's own code.
   *
   * A transaction that emitted an event from the v1 anonymizer ran through a
   * contract we wrote, and it does not stop having done so because a v2 was
   * deployed afterwards. Without this, repointing the active deployment made
   * every historical transaction reclassify from "scores" to "counts for
   * nothing" — six of ten, in one edit, with the chain unchanged.
   */
  readonly superseded?: readonly {
    readonly address: string;
    readonly kind: "registry" | "anonymizer";
  }[];
}

export interface ReceiptVerdict {
  readonly succeeded: boolean;
  readonly revertReason?: string;
  readonly blockNumber?: number;
  readonly poolEvents: number;
  readonly ourEvents: readonly { readonly from: string; readonly role: "registry" | "anonymizer" }[];
  /** SUCCEEDED and at least one event from Aperture's own code. */
  readonly scores: boolean;
  /** SUCCEEDED and at least one event from the pool. Looser. */
  readonly passesOrganizerCheck: boolean;
}

/**
 * Addresses are compared numerically. Starknet felts are routinely written with
 * and without leading-zero padding, and a string compare silently reports "no
 * match" for two spellings of the same address.
 */
const sameAddress = (a: string, b: string): boolean => {
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return false;
  }
};

export function classifyReceipt(
  receipt: RawReceipt,
  context: ReceiptContext,
): ReceiptVerdict {
  const succeeded = receipt.execution_status === "SUCCEEDED";
  const events = receipt.events ?? [];

  const poolEvents = events.filter((e) => sameAddress(e.from_address, context.pool)).length;

  type OurEvent = { from: string; role: "registry" | "anonymizer" };
  const ourEvents: OurEvent[] = [];
  const ours: readonly { address: string; kind: "registry" | "anonymizer" }[] = [
    { address: context.anonymizer, kind: "anonymizer" },
    { address: context.registry, kind: "registry" },
    ...(context.superseded ?? []),
  ];
  for (const e of events) {
    const match = ours.find((o) => sameAddress(e.from_address, o.address));
    if (match) ourEvents.push({ from: e.from_address, role: match.kind });
  }

  return {
    succeeded,
    revertReason: receipt.revert_reason,
    blockNumber: receipt.block_number,
    poolEvents,
    ourEvents,
    scores: succeeded && ourEvents.length > 0,
    passesOrganizerCheck: succeeded && poolEvents > 0,
  };
}

/** A one-line human summary, used by the scripts and by the demo. */
export function describeVerdict(hash: string, v: ReceiptVerdict): string {
  const head = `${hash.slice(0, 12)}…  ${v.succeeded ? "SUCCEEDED" : "REVERTED "}`;
  const events = `${v.poolEvents} pool · ${v.ourEvents.length} ours`;
  const rule = v.scores
    ? "[scores]"
    : v.passesOrganizerCheck
      ? "[organizer-check only]"
      : "[counts for nothing]";
  return `${head}  ${events.padEnd(18)} ${rule}`;
}
