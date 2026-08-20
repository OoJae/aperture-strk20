"use client";

/**
 * Motion plumbing: smooth scroll, one shared scroll-progress value for the
 * iris, and a reveal that fires once.
 *
 * Deliberately small. The site has exactly one choreographed scene; everything
 * else either reveals once on entry or does not move at all.
 */

import { useEffect, useState } from "react";

/** Smooth scroll for the whole document. Lenis, gentle lerp, no scroll-jacking. */
export function useSmoothScroll(): void {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let stop: (() => void) | undefined;
    (async () => {
      const { default: Lenis } = await import("lenis");
      const lenis = new Lenis({ lerp: 0.1 });
      let raf = 0;
      const frame = (time: number) => {
        lenis.raf(time);
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      stop = () => {
        cancelAnimationFrame(raf);
        lenis.destroy();
      };
    })();

    return () => stop?.();
  }, []);
}

/**
 * How far through the page we are, 0–1. The iris reads this and nothing else.
 * Reduced motion pins it open rather than leaving the iris shut and lifeless.
 */
export function useScrollProgress(): number {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setProgress(1);
      return;
    }

    let raf = 0;
    const read = () => {
      const span = document.body.scrollHeight - window.innerHeight;
      setProgress(span > 0 ? window.scrollY / span : 0);
      raf = 0;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };

    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return progress;
}

/**
 * Marks `[data-reveal]` elements shown once they are ~15% into view, which the
 * stylesheet turns into a masked slide. Once only — nothing here loops.
 */
export function useReveals(): void {
  useEffect(() => {
    const targets = document.querySelectorAll<HTMLElement>("[data-reveal]");
    if (!targets.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target as HTMLElement;
          const delay = Number(el.dataset.delay ?? 0);
          window.setTimeout(() => {
            el.dataset.shown = "true";
          }, delay);
          observer.unobserve(el);
        });
      },
      { rootMargin: "0px 0px -15% 0px" },
    );

    targets.forEach((t) => observer.observe(t));
    return () => observer.disconnect();
  }, []);
}
