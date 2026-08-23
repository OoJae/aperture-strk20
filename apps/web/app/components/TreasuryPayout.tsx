"use client";

/**
 * Executing a treasury payout, through Aperture's own anonymizer.
 *
 * Everything else on this page is a read. This is the one control that writes,
 * it spends real STRK, and it cannot be undone — so it says what it will do
 * before it does it, and afterwards it says only what it can prove.
 *
 * Three things this component used to get wrong, each fixed below:
 *
 *   - It reported success from a transaction hash alone. A hash means accepted,
 *     not executed; a reverted transaction rendered "Payout registered."
 *   - Its timeout claimed "Nothing was submitted and no fee was charged", which
 *     it had no way to know: a Promise.race abandons the wallet call, it does
 *     not cancel it.
 *   - It told the user their preimage "can claim the payout" when no claim has
 *     ever succeeded on any network.
 */

import { useEffect, useRef, useState } from "react";
import { hash, num, shortString } from "starknet";
import { walletV6 } from "starknet";
import { DEMO, classifyReceipt, mintPayout } from "@oojae/strk20-governance";
import {
  ANONYMIZER_ADDRESS,
  DEPLOYMENT,
  POOL_ADDRESS,
  REGISTRY_ADDRESS,
  STRK_TOKEN,
  VOYAGER,
  getPayoutDomain,
  hasPassed,
  provider,
  readChain,
  shortHex,
} from "../lib/chain.ts";
import { formatWeight } from "../lib/format.ts";
import { buildRegisterPayoutActions } from "../lib/payout.ts";

/** STRK20 landed in Wallet API 0.10.3; below that the call does not exist. */
function supportsStrk20(versions: string[]): boolean {
  return versions.some((v) => {
    const [maj = 0, min = 0, patch = 0] = String(v).split(".").map(Number);
    return maj > 0 || min > 10 || (min === 10 && patch >= 3);
  });
}

/**
 * Proving normally takes about half a minute, but the wallet's relay has been
 * known to hang rather than fail. This deadline stops the page waiting forever.
 *
 * Named for what it does: it stops *us* waiting. It does not stop the wallet,
 * which may still prove and submit afterwards — which is why the copy on this
 * path never claims nothing was sent.
 */
const PROVING_DEADLINE_MS = 180_000;

function raceDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new DeadlineError()), ms),
    ),
  ]);
}

class DeadlineError extends Error {
  constructor() {
    super("deadline");
    this.name = "DeadlineError";
  }
}

type State =
  | { kind: "idle" }
  | { kind: "working"; note: string }
  | { kind: "confirming"; hash: string }
  | { kind: "registered"; hash: string; block?: number; secret: string; commitment: string }
  | { kind: "reverted"; hash: string; reason?: string }
  | { kind: "unknown"; message: string }
  | { kind: "error"; message: string };

const STORAGE_PREFIX = "aperture:payout:";

export function TreasuryPayout() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [proposalPassed, setProposalPassed] = useState<boolean>();
  const [recoverHash, setRecoverHash] = useState("");
  const outcomeRef = useRef<HTMLDivElement>(null);

  const busy = state.kind === "working" || state.kind === "confirming";
  const amount = formatWeight(DEMO.payoutAmount);

  /**
   * `register_payout` asserts the proposal passed. Reading that first means a
   * user does not pay a pool fee to discover PROPOSAL_NOT_PASSED.
   */
  useEffect(() => {
    hasPassed(DEMO.payoutProposalId).then(setProposalPassed).catch(() => setProposalPassed(undefined));
  }, []);

  /** Move focus to the outcome so a screen reader lands on the result. */
  useEffect(() => {
    if (["registered", "reverted", "unknown", "error"].includes(state.kind)) {
      outcomeRef.current?.focus();
    }
  }, [state.kind]);

  async function confirm(txHash: string, secret?: string, commitment?: string): Promise<void> {
    setState({ kind: "confirming", hash: txHash });
    try {
      const receipt = await readChain((p) => p.waitForTransaction(txHash, { retryInterval: 3_000 }));
      const verdict = classifyReceipt(receipt as never, {
        pool: POOL_ADDRESS,
        registry: REGISTRY_ADDRESS,
        anonymizer: ANONYMIZER_ADDRESS,
      });

      if (!verdict.succeeded) {
        setState({ kind: "reverted", hash: txHash, reason: verdict.revertReason });
        return;
      }
      if (verdict.ourEvents.length === 0) {
        setState({
          kind: "unknown",
          message:
            `Transaction ${shortHex(txHash, 10, 6)} succeeded, but it emitted no event ` +
            `from GovernanceAnonymizer. Value may have moved into the anonymizer without ` +
            `a payout being registered against it — which nobody can recover.`,
        });
        return;
      }
      setState({
        kind: "registered",
        hash: txHash,
        block: verdict.blockNumber,
        secret: secret ?? "(not generated in this browser)",
        commitment: commitment ?? "",
      });
    } catch (error) {
      setState({
        kind: "unknown",
        message:
          `Could not confirm ${shortHex(txHash, 10, 6)} against the chain: ` +
          `${error instanceof Error ? error.message : "unknown error"}. The transaction may ` +
          `still be valid — check it on Voyager.`,
      });
    }
  }

  async function run(): Promise<void> {
    try {
      setState({ kind: "working", note: "connecting" });

      const store = (await import("@starknet-io/get-starknet-discovery")).createStore({
        eip1193Adapters: [],
      });

      // Capability, not brand. Filtering on /ready|argent/ told every other
      // Starknet wallet that it did not exist.
      const candidates = store.getWallets() as { name?: string }[];
      if (candidates.length === 0) {
        throw new Error("No Starknet wallet found in this browser. Install one and reload.");
      }

      let wallet: unknown;
      const rejected: string[] = [];
      for (const candidate of candidates) {
        try {
          await walletV6.requestAccounts(candidate as never);
          const versions = (await walletV6.supportedWalletApi(candidate as never)) as string[];
          if (supportsStrk20(versions)) {
            wallet = candidate;
            break;
          }
          rejected.push(`${candidate.name ?? "unnamed"} (Wallet API ${versions.join(", ")})`);
        } catch {
          rejected.push(`${candidate.name ?? "unnamed"} (declined)`);
        }
      }
      if (!wallet) {
        throw new Error(
          `STRK20 needs Wallet API 0.10.3 or newer. Wallets found: ${rejected.join("; ")}.`,
        );
      }

      const chainId = await walletV6.requestChainId(wallet as never);
      if (BigInt(chainId) !== BigInt(shortString.encodeShortString(DEPLOYMENT.chainId))) {
        throw new Error(
          `Switch the wallet to ${DEPLOYMENT.label} — this payout runs against the live pool.`,
        );
      }

      setState({ kind: "working", note: "building the call" });

      // The domain comes from the contract that will check the commitment. A
      // commitment built against the wrong one still registers — the contract
      // stores whatever hash it is given — and then can never be claimed.
      const domain = await getPayoutDomain();

      // Ticket and commitment together, from one call. Building them from two
      // different sets of terms stores an entry no claim can reproduce, and
      // nothing on chain can catch it: the contract never sees the preimage at
      // registration.
      const { ticket, commitment } = mintPayout({
        domain,
        proposalId: DEMO.payoutProposalId,
        token: STRK_TOKEN,
        amount: DEMO.payoutAmount,
      });
      const secret = ticket.secret;

      // Written BEFORE submitting. A crash between submit and render used to
      // lose the preimage permanently, which is exactly how value became
      // unrecoverable on mainnet.
      try {
        sessionStorage.setItem(
          `${STORAGE_PREFIX}${commitment}`,
          JSON.stringify({ secret, commitment, amount: DEMO.payoutAmount.toString() }),
        );
      } catch {
        /* private browsing; the preimage is still shown on screen */
      }

      const actions = buildRegisterPayoutActions({
        token: STRK_TOKEN,
        amount: DEMO.payoutAmount,
        proposalId: DEMO.payoutProposalId,
        commitment,
      });

      setState({ kind: "working", note: "proving — this takes about half a minute" });
      const { WalletAccountV6 } = await import("starknet");
      const account = await WalletAccountV6.connect(provider() as never, wallet as never);

      const result = await raceDeadline(
        (
          account as unknown as {
            strk20InvokeTransaction: (a: unknown[]) => Promise<{ transaction_hash: string }>;
          }
        ).strk20InvokeTransaction(actions),
        PROVING_DEADLINE_MS,
      );

      await confirm(result.transaction_hash, secret, commitment);
    } catch (error) {
      if (error instanceof DeadlineError) {
        setState({
          kind: "unknown",
          message:
            "The wallet did not respond within three minutes. This does not mean nothing " +
            "was submitted — the wallet may still be proving, and a transaction may land " +
            "after this message. Check your wallet's activity; if you have a hash, paste " +
            "it below and this page will confirm it against the chain.",
        });
        return;
      }
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : "something went wrong",
      });
    }
  }

  return (
    <section className="panel" aria-busy={busy}>
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
        Real STRK on {DEPLOYMENT.label}: <strong>{amount.display}</strong> for
        the payout, plus the pool&rsquo;s flat fee, both taken from your{" "}
        <em>shielded</em> balance. You need that balance already; this page
        cannot shield for you. Your wallet will ask twice, and proving takes
        roughly thirty seconds.
      </p>

      {proposalPassed === false ? (
        <p className="banner-danger" role="alert">
          Proposal #{DEMO.payoutProposalId.toString()} has not passed on{" "}
          {DEPLOYMENT.label}, and the anonymizer asserts that it has before it
          will register anything. This payout would revert.
        </p>
      ) : null}

      <div className="actions">
        <button type="button" className="cta" onClick={run} disabled={busy || proposalPassed === false}>
          Register a {amount.display} payout
        </button>
        {state.kind !== "idle" && !busy ? (
          <button type="button" className="cta secondary" onClick={() => setState({ kind: "idle" })}>
            Start over
          </button>
        ) : null}
      </div>

      {busy ? (
        <p className="dim" role="status" aria-live="polite">
          {state.kind === "working" ? `${state.note}…` : `confirming ${shortHex(state.hash, 10, 6)} on chain…`}
        </p>
      ) : null}

      <div ref={outcomeRef} tabIndex={-1}>
        {state.kind === "registered" ? (
          <div role="status" aria-live="polite">
            <p className="ok">
              Payout registered — confirmed by a <span className="mono">PayoutRegistered</span>{" "}
              event from GovernanceAnonymizer
              {state.block ? ` in block ${state.block.toLocaleString()}` : ""}.
            </p>
            <p className="small">
              <a href={`${VOYAGER}/tx/${state.hash}`} target="_blank" rel="noreferrer">
                {shortHex(state.hash, 12, 8)}
              </a>
            </p>
            <p className="small">Save this preimage. It is not stored on any server:</p>
            <p className="mono small">{state.secret}</p>
            <p className="banner-danger small">
              <strong>No claim has ever succeeded, on any network.</strong> The
              claim leg fails with <span className="mono">NON_ZERO_VALUE</span>{" "}
              and is unfinished. Treat this payout as unrecoverable until that
              sentence changes: 14 STRK is already permanently locked in this
              contract because earlier preimages were shown once and never saved,
              and it has no sweep function and no owner.
            </p>
          </div>
        ) : null}

        {state.kind === "reverted" ? (
          <div role="alert">
            <p className="bad">
              The transaction reverted on chain. Nothing was paid out, and the
              pool&rsquo;s fee was still charged.
            </p>
            {state.reason ? <p className="mono small">{state.reason}</p> : null}
            <p className="small">
              <a href={`${VOYAGER}/tx/${state.hash}`} target="_blank" rel="noreferrer">
                {shortHex(state.hash, 12, 8)}
              </a>
            </p>
          </div>
        ) : null}

        {state.kind === "unknown" ? (
          <div role="alert">
            <p className="bad">{state.message}</p>
            <div className="actions">
              <input
                className="mono"
                aria-label="Transaction hash to confirm"
                placeholder="0x… transaction hash"
                value={recoverHash}
                onChange={(e) => setRecoverHash(e.target.value)}
              />
              <button
                type="button"
                className="cta"
                disabled={!/^0x[0-9a-fA-F]{1,64}$/.test(recoverHash.trim())}
                onClick={() => confirm(recoverHash.trim())}
              >
                Confirm it
              </button>
            </div>
          </div>
        ) : null}

        {state.kind === "error" ? (
          <p className="bad" role="alert">
            {state.message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
