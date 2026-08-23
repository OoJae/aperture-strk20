/**
 * Turn a chain error into something a person can read.
 *
 * starknet.js puts the entire rejected transaction into `error.message` when a
 * node refuses one, and a pool transaction carries its proof inline — so a
 * failed registration printed 78KB, of which 78,780 characters were one base64
 * blob. The cause was in there somewhere. Nobody was going to find it.
 *
 * Everything that matters is short and lives at the front or in a named field,
 * so keep those and drop the payload.
 */

/** Fields worth pulling out by name, in the order they are most likely to say why. */
const INTERESTING = [
  "revert_reason",
  "execution_error",
  "transaction_failure_reason",
  "error_reason",
  "message",
] as const;

const BULK = /"(proof|proof_facts|calldata|signature|state_diff|contract_class|program)"\s*:\s*(\[[\s\S]*?\]|"[^"]*")/g;

export function describeError(error: unknown, limit = 800): string {
  const raw = error instanceof Error ? error.message : String(error);

  // A pulled-out reason beats a truncated dump every time.
  for (const key of INTERESTING) {
    const match = raw.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
    if (match?.[1] && match[1].length < limit) return match[1].replace(/\\n/g, "\n");
  }

  const trimmed = raw.replace(BULK, '"$1": <elided>');
  if (trimmed.length <= limit) return trimmed;
  // Head AND tail. An RPC error leads with the request it was called with and
  // ends with why it was refused, so truncating from the front throws away the
  // only part anyone wanted.
  const half = Math.floor(limit / 2);
  return (
    `${trimmed.slice(0, half)}\n      … ${trimmed.length - limit} characters elided …\n` +
    trimmed.slice(-half)
  );
}
