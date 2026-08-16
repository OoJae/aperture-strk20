/**
 * `@aperture/strk20-governance` — sealed-ballot governance on the STRK20
 * shielded pool.
 *
 * Phase 0 publishes the intended surface as types only, so the shape can be
 * reviewed before the implementations land. Extraction and the npm release
 * happen in Phase 5.
 */

/** Ballot choices. Each gets its own receiving identity per proposal. */
export type Choice = "for" | "against" | "abstain";

/**
 * A per-proposal, per-choice receiving identity.
 *
 * A vote is an ordinary private transfer into one of these, so an observer
 * sees a pool transaction and nothing else — not the choice, not the weight.
 */
export interface BallotIdentity {
  proposalId: bigint;
  choice: Choice;
  /** Address the voter sends their shielded weight to. */
  address: string;
}

/** Aggregate result posted on-chain after the voting window closes. */
export interface TallyResult {
  proposalId: bigint;
  forWeight: bigint;
  againstWeight: bigint;
  abstainWeight: bigint;
}

/**
 * Derives the receiving identity for one proposal/choice pair.
 *
 * Must be deterministic and reproducible client-side: the voter derives the
 * address to send to, and the tally service derives the same one to read from.
 */
export declare function deriveBallotIdentity(
  proposalId: bigint,
  choice: Choice,
): Promise<BallotIdentity>;

/**
 * Sums the notes received by each choice's identity into an aggregate.
 *
 * Note discovery is scoped to a single viewing key, so the caller holds one
 * client per ballot identity. Individual ballots never leave the service.
 */
export declare function tallyProposal(proposalId: bigint): Promise<TallyResult>;
