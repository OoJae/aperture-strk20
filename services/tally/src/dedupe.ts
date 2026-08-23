/**
 * One deduplication pass, shared by the tally and the refund queue.
 *
 * They used to do this separately with differently-scoped Sets: the aggregator
 * used a fresh Set per choice, the refund queue used one Set across all three
 * identities. A note id appearing under two identities was therefore counted
 * twice in the tally and refunded once — two numbers that are supposed to
 * describe the same set of ballots, disagreeing.
 *
 * Physically a note id binds the recipient channel, so the same id cannot
 * legitimately arrive at two identities. Observing it means discovery is
 * faulty, and the honest response to a faulty read of an election is to stop,
 * not to pick a winner.
 */

import type { BallotIdentity } from "@aperture/strk20-governance";
import type { DiscoveredNote } from "./discovery.ts";

export class DuplicateNoteError extends Error {
  constructor(noteId: string, first: string, second: string) {
    super(
      `Note ${noteId} appears under both "${first}" and "${second}". A note id ` +
        `binds one recipient channel, so this is a discovery fault rather than a ` +
        `tie. Refusing to count.`,
    );
    this.name = "DuplicateNoteError";
  }
}

export interface DiscoveredForIdentity {
  identity: BallotIdentity;
  notes: readonly DiscoveredNote[];
}

export function dedupeAcrossIdentities(
  discovered: readonly DiscoveredForIdentity[],
): DiscoveredForIdentity[] {
  const owner = new Map<string, string>();

  return discovered.map(({ identity, notes }) => {
    const kept: DiscoveredNote[] = [];
    const seen = new Set<string>();

    for (const note of notes) {
      // The same note twice on one identity is a page boundary, which is fine.
      if (seen.has(note.id)) continue;

      const other = owner.get(note.id);
      if (other !== undefined && other !== identity.choice) {
        throw new DuplicateNoteError(note.id, other, identity.choice);
      }

      owner.set(note.id, identity.choice);
      seen.add(note.id);
      kept.push(note);
    }

    return { identity, notes: kept };
  });
}
