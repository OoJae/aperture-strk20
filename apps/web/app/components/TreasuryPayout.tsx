"use client";

/**
 * Executing a treasury payout on mainnet, through Aperture's own anonymizer.
 *
 * Everything else on this page is a read. This is the one control that writes,
 * and it is deliberately explicit about what it will do before it does it: a
 * payout spends real STRK and cannot be undone.
 */

import { useState } from "react";
import { hash, num, shortString } from "starknet";
import { walletV6 } from "starknet";
import { ANONYMIZER_ADDRESS, VOYAGER, shortHex } from "../lib/chain.ts";
import {
  PAYOUT_TAG,
  buildFundAnonymizerActions,
  buildRegisterPayoutActions,
} from "../lib/payout.ts";

const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

/** Proposal 2 on the mainnet registry — finalized and passed. */
const PROPOSAL_ID = 2n;
const AMOUNT = 2n * 10n ** 18n;

/**
 * Deliberately small. The pool's flat fee dwarfs it either way, and a smaller
 * withdrawal selects fewer notes — which is the other thing that makes a proof
 * expensive to produce.
 */
const FUND_AMOUNT = 1n * 10n ** 18n;

/** STRK20 landed in Wallet API 0.10.3; below that the call does not exist. */
function supportsStrk20(versions: string[]): boolean {
  return versions.some((v) => {
    const [maj = 0, min = 0, patch = 0] = String(v).split(".").map(Number);
    return maj > 0 || min > 10 || (min === 10 && patch >= 3);
  });
}

/**
 * Proving normally takes about half a minute. The wallet's proving relay has
 * been known to hang rather than fail, and an unbounded await leaves the page
 * spinning forever with nothing to act on — so give up and say so.
 */
const PROVING_TIMEOUT_MS = 180_000;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              "The wallet's proving service did not respond within three minutes. " +
                "Nothing was submitted and no fee was charged — this is usually " +
                "the relay being unavailable rather than anything wrong here. Try again later.",
            ),
          ),
        ms,
      ),
    ),
  ]);
}

type State =
  | { kind: "idle" }
  | { kind: "working"; note: string }
  | { kind: "done"; hash: string; secret: string }
  | { kind: "error"; message: string };

export function TreasuryPayout() {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function run(mode: "payout" | "fund") {
    try {
      setState({ kind: "working", note: "connecting" });

      const store = (
        await import("@starknet-io/get-starknet-discovery")
      ).createStore({ eip1193Adapters: [] });
      const wallet = store
        .getWallets()
        .find((w: { name?: string }) => /ready|argent/i.test(w.name ?? ""));
      if (!wallet) throw new Error("No Ready wallet found. Install it and reload.");

      await walletV6.requestAccounts(wallet as never);

      const versions = (await walletV6.supportedWalletApi(wallet as never)) as string[];
      if (!supportsStrk20(versions)) {
        throw new Error(
          `This wallet advertises Wallet API ${versions.join(", ")}; STRK20 needs 0.10.3 or newer.`,
        );
      }

      const chainId = await walletV6.requestChainId(wallet as never);
      if (BigInt(chainId) !== BigInt(shortString.encodeShortString("SN_MAIN"))) {
        throw new Error("Switch the wallet to Mainnet — this payout runs against the live pool.");
      }

      // The preimage is the only thing that can later open this payout, so it
      // is generated here and shown once. Nothing derived from it is stored.
      setState({ kind: "working", note: "building the call" });
      const bytes = crypto.getRandomValues(new Uint8Array(30));
      const secret = `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
      const commitment = hash.computePoseidonHashOnElements([
        num.toHex(BigInt(shortString.encodeShortString(PAYOUT_TAG))),
        secret,
      ]);

      const params = {
        token: STRK,
        amount: AMOUNT,
        proposalId: PROPOSAL_ID,
        commitment,
      };
      const actions =
        mode === "payout"
          ? buildRegisterPayoutActions(params)
          : buildFundAnonymizerActions({ ...params, amount: FUND_AMOUNT });

      setState({ kind: "working", note: "proving — this takes about half a minute" });
      const { WalletAccountV6 } = await import("starknet");
      const { RpcProvider } = await import("starknet");
      const account = await WalletAccountV6.connect(
        new RpcProvider({ nodeUrl: "https://starknet-rpc.publicnode.com" }) as never,
        wallet as never,
      );

      const result = await withTimeout(
        (
          account as unknown as {
            strk20InvokeTransaction: (a: unknown[]) => Promise<{ transaction_hash: string }>;
          }
        ).strk20InvokeTransaction(actions),
        PROVING_TIMEOUT_MS,
      );

      setState({ kind: "done", hash: result.transaction_hash, secret });
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : "something went wrong",
      });
    }
  }

  return (
    <section className="panel">
      <h2>Execute a treasury payout</h2>
      <p className="lede">
        The pool withdraws to{" "}
        <a
          href={`${VOYAGER}/contract/${ANONYMIZER_ADDRESS}`}
          target="_blank"
          rel="noreferrer"
          className="mono"
        >
          {shortHex(ANONYMIZER_ADDRESS, 10, 6)}
        </a>{" "}
        and calls its <span className="mono">privacy_invoke</span>, which parks
        the value against a commitment. Only whoever holds the preimage can open
        it — and the chain never learns who that is.
      </p>

      <p className="small dim">
        Real STRK on mainnet: <strong>2 STRK</strong> for the payout plus the
        pool&rsquo;s flat fee. Your wallet will ask twice, and proving takes
        roughly thirty seconds.
      </p>

      {state.kind === "idle" ? (
        <div className="actions">
          <button className="cta" onClick={() => run("payout")}>
            Register a 2 STRK payout
          </button>
          <button className="cta secondary" onClick={() => run("fund")}>
            Fund the anonymizer with 1 STRK
          </button>
        </div>
      ) : null}

      <p className="small dim">
        The first runs the whole payout — five phases for the pool to prove. The
        second moves treasury value into the anonymizer and nothing else, which
        is about as cheap as a pool transaction gets; use it when the
        wallet&rsquo;s proving relay is refusing the longer one.
      </p>

      {state.kind === "working" ? <p className="dim">{state.note}…</p> : null}

      {state.kind === "error" ? <p className="bad">{state.message}</p> : null}

      {state.kind === "done" ? (
        <div>
          <p className="ok">Payout registered.</p>
          <p className="small">
            <a href={`${VOYAGER}/tx/${state.hash}`} target="_blank" rel="noreferrer">
              {shortHex(state.hash, 12, 8)}
            </a>
          </p>
          <p className="small bad">
            Save this preimage — it is the only thing that can claim the payout,
            and it is not stored anywhere:
          </p>
          <p className="mono small">{state.secret}</p>
        </div>
      ) : null}
    </section>
  );
}
