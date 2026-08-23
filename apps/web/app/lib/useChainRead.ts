"use client";

/**
 * One read hook for every component that talks to the chain.
 *
 * Both read paths were hand-rolled effects with no timeout and no retry, so a
 * stalled endpoint left the page on "Reading mainnet…" indefinitely and the
 * error branch offered no way to try again. CLAUDE.md asks for a real progress
 * state rather than a spinner that reads as hung; the write path got that and
 * the read paths, which every visitor exercises, did not.
 */

import { useCallback, useEffect, useState } from "react";

export type ReadState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

export function useChainRead<T>(
  read: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): ReadState<T> & { retry: () => void } {
  const [state, setState] = useState<ReadState<T>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;

    read(controller.signal)
      .then((data) => {
        if (live && !controller.signal.aborted) setState({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (!live || controller.signal.aborted) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "unknown error",
        });
      });

    return () => {
      live = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { ...state, retry };
}
