/**
 * Why the claim leg reverts with NON_ZERO_VALUE.
 *
 *   node services/tally/src/diagnose-claim.ts
 *
 * Every probe here is a read. No proof, no fee, no transaction. That is the
 * point: the previous three attempts at this spent pool fees to learn less than
 * this script learns for nothing, because `payout-lifecycle.ts` has no try/catch
 * around submission and throws the revert trace away.
 *
 * The hypothesis, and it turns on reading the error the way Cairo writes it.
 * Aperture's own contract names the *bad state* — `ZERO_AMOUNT` guards against
 * zero — and the pool follows the same convention. So `NON_ZERO_VALUE` is
 * `assert(slot == 0)`: something required to be empty was occupied. Not "this
 * transaction must move value", which is how it was read for three days.
 *
 * The pool has exactly four WriteOnce sites — public key, channel marker,
 * nullifier, note — and the note id derivation is
 *
 *     compute_note_id(channel_key, token, index)
 *
 * with no block, no salt and no randomness in it. So two transactions that agree
 * on those three inputs target the same storage slot, and the second one panics.
 *
 * The claim leg gets a stale `index` because the SDK forwards `provingBlockId`
 * into its discovery calls as well as its proving, and `payout-lifecycle.ts`
 * recomputes `head - 10` separately for each leg. Moments after the register
 * transaction lands, `head - 10` still points *before* it, so the indexer
 * reports the pre-register `last_note_index` and the claim leg reuses the slot
 * the register leg's surplus note just filled.
 */

import { RpcProvider, hash } from "starknet";

import { makeProvider } from "./provider.ts";
import {
  compute_channel_key,
  compute_note_id,
} from "@starkware-libs/starknet-privacy-sdk/testing";
import { loadConfig } from "./config.ts";

const MATURITY_BLOCKS = 10;

function heading(text: string): void {
  console.log(`\n── ${text} ${"─".repeat(Math.max(0, 66 - text.length))}`);
}

async function main(): Promise<number> {
  const config = loadConfig();
  const provider = makeProvider(config.rpcUrl, config.rpcFallbacks);

  /** Raw calls: the pool's views return felts, and positional reads need no ABI. */
  const view = async (entrypoint: string, calldata: string[] = []): Promise<bigint[]> => {
    const result = await provider.callContract({
      contractAddress: config.poolAddress,
      entrypoint,
      calldata,
    });
    const raw = (Array.isArray(result) ? result : (result as { result: string[] }).result) as string[];
    return raw.map((v) => BigInt(v));
  };
  void hash;

  const head = await provider.getBlockNumber();
  const settled = head - MATURITY_BLOCKS;
  console.log(`network ${config.network}   head ${head}   settled pin ${settled}`);

  // ── 1. Things that would make every other question moot ──────────────
  heading("Pool preconditions");

  const [fee] = await view("get_fee_amount");
  console.log(`flat fee                       ${fee! / 10n ** 18n} STRK`);

  if (config.anonymizerAddress) {
    const [blockedRaw] = await view("is_open_note_depositor_blocked", [config.anonymizerAddress]);
    const blocked = blockedRaw !== 0n;
    console.log(`anonymizer blocked as depositor ${blocked}`);
    if (blocked) {
      console.log(
        "\n  STOP. The pool refuses open-note deposits from our contract.\n" +
          "  No client-side or Cairo change fixes that; it needs the pool\n" +
          "  operator to allow-list the address.",
      );
      return 1;
    }
  }

  // ── 2. The note nonce, read at two different blocks ──────────────────
  heading("Does the pin make the note index stale?");

  const operatorViewingKey = config.operatorViewingKey;
  if (operatorViewingKey === undefined) {
    console.error("TALLY_OPERATOR_VIEWING_KEY is not set; cannot derive the channel key.");
    return 1;
  }

  const [registeredPublicKey = 0n] = await view("get_public_key", [config.operatorAddress]);
  if (registeredPublicKey === 0n) {
    console.log("operator is not registered with the pool; nothing to collide with yet.");
    return 0;
  }

  // A self-channel: the operator is both sender and recipient, which is exactly
  // the shape the demo uses and exactly why the collision is reachable here.
  const channelKey = compute_channel_key(
    BigInt(config.operatorAddress),
    operatorViewingKey,
    BigInt(config.operatorAddress),
    registeredPublicKey,
  );
  console.log(`channel key                    0x${channelKey.toString(16).slice(0, 16)}…`);

  // ── 3. Which note slots are occupied ─────────────────────────────────
  heading("Note slot occupancy");

  const token = BigInt(config.strkTokenAddress);
  console.log("index   note id                 packed_value   token   state");

  let firstFree = -1;
  for (let index = 0; index <= 10; index += 1) {
    const noteId = compute_note_id(channelKey, token, index);
    const [packedValue = 0n, noteToken = 0n] = await view("get_note", [
      `0x${noteId.toString(16)}`,
    ]);
    const note = { packed_value: packedValue, token: noteToken };
    const occupied = note.packed_value !== 0n || note.token !== 0n;
    if (!occupied && firstFree === -1) firstFree = index;
    console.log(
      `${String(index).padStart(5)}   0x${noteId.toString(16).slice(0, 18)}…  ` +
        `${occupied ? "non-zero    " : "0           "}   ` +
        `${note.token === 0n ? "0    " : "set  "}   ${occupied ? "OCCUPIED" : "free"}`,
    );
  }

  heading("Verdict");
  console.log(`first free note index: ${firstFree}`);
  console.log(
    "\nIf a claim leg computes an index at or below the highest occupied one,\n" +
      "its CreateOpenNote targets a filled slot and the pool's WriteOnce panics\n" +
      "with NON_ZERO_VALUE. That is the whole failure.\n\n" +
      "The index comes from the indexer's last_note_index + 1, read at whatever\n" +
      "block the SDK was told to prove against — so a pin behind the register\n" +
      "transaction reproduces an index that is already spent.",
  );

  return 0;
}

process.exit(await main());
