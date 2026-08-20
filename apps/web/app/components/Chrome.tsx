"use client";

/**
 * The site frame: nav, smooth scroll, reveals, and the iris that follows you
 * down the page. Everything that needs to be alive lives here so the pages
 * themselves stay declarative.
 */

import type { CSSProperties, ReactNode } from "react";
import { Iris } from "./Iris.tsx";
import { useReveals, useScrollProgress, useSmoothScroll } from "../lib/motion.ts";

export function Chrome({
  children,
  iris = true,
}: {
  children: ReactNode;
  iris?: boolean;
}) {
  useSmoothScroll();
  useReveals();
  const progress = useScrollProgress();

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>

      <header className="nav">
        <a className="nav-mark" href="/">
          <img src="/aperture.svg" alt="" width={20} height={20} />
          <span>Aperture</span>
        </a>
        <nav aria-label="Primary">
          <a href="/how">How it works</a>
          <a href="/trust">What&rsquo;s private</a>
          <a href="/proof">Proof</a>
        </nav>
        {/* Sibling of the link list, not a member of it: it is the one action,
            not a fourth destination. Being a direct child of .nav is also what
            lets the mobile grid place it without absolute positioning. */}
        <a className="nav-cta" href="/app">
          Open the app
        </a>
      </header>

      {iris ? (
        <div
          className="iris-stage"
          aria-hidden="true"
          /* The iris is the hero's subject, then it gets out of the way. Same
             single scroll scene — presence recedes as the reading starts. */
          style={{ "--iris-presence": 0.82 - progress * 0.56 } as CSSProperties}
        >
          <Iris progress={progress} />
        </div>
      ) : null}

      <main id="main">{children}</main>

      <footer className="foot shell">
        <hr className="rule" />
        <div className="foot-row">
          <span className="label">Aperture · Starknet mainnet</span>
          <span className="label">
            <a href="https://github.com/OoJae/aperture-strk20">Source</a> · MIT
          </span>
        </div>
      </footer>
    </>
  );
}
