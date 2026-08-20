"use client";

/**
 * The iris — the one loud thing on this site.
 *
 * Six blades of real geometry, rotating and retracting exactly the way a camera
 * aperture does. Scroll drives a single value: how far it is open. Nothing else
 * on the page animates on scroll, because one choreographed scene lands harder
 * than a dozen scattered effects.
 *
 * It is also the argument. A sealed ballot is an aperture almost shut — value
 * passes through, almost nothing escapes. The tally is the moment it opens.
 */

import { useEffect, useRef, useState } from "react";

const BLADES = 6;

/** How open the iris is at rest, before scroll has said otherwise. */
const CLOSED = 0.14;
const OPEN = 0.78;

export function Iris({ progress = 0 }: { progress?: number }) {
  const mount = useRef<HTMLDivElement>(null);
  const target = useRef(CLOSED);
  const [webgl, setWebgl] = useState<boolean | null>(null);

  target.current = CLOSED + (OPEN - CLOSED) * Math.min(1, Math.max(0, progress));

  useEffect(() => {
    const host = mount.current;
    if (!host) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let disposed = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      let THREE: typeof import("three");
      try {
        THREE = await import("three");
      } catch {
        setWebgl(false);
        return;
      }

      let renderer: import("three").WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      } catch {
        // Locked-down machine, software rendering disabled, ancient browser.
        // The SVG below is not a consolation prize; it is the same drawing.
        setWebgl(false);
        return;
      }
      if (disposed) {
        renderer.dispose();
        return;
      }
      setWebgl(true);

      const size = () => Math.min(host.clientWidth, host.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(size(), size(), false);
      host.appendChild(renderer.domElement);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      renderer.domElement.setAttribute("aria-hidden", "true");

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
      camera.position.set(0, 0, 7.2);

      /**
       * One blade. The long straight inner edge is what matters: six of these
       * overlapping leave a hexagonal opening, which is how an aperture reads
       * as a mechanism rather than as a shrinking circle.
       */
      const shape = new THREE.Shape();
      shape.moveTo(0.0, -0.98);
      shape.lineTo(1.72, -0.62);
      shape.lineTo(1.86, 0.72);
      shape.lineTo(0.12, 0.98);
      shape.closePath();

      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: 0.05,
        bevelEnabled: true,
        bevelThickness: 0.012,
        bevelSize: 0.012,
        bevelSegments: 2,
      });

      const ink = new THREE.MeshStandardMaterial({
        color: 0x1b1c22,
        metalness: 0.65,
        roughness: 0.42,
      });
      const lit = new THREE.MeshStandardMaterial({
        color: 0xff3b18,
        metalness: 0.3,
        roughness: 0.5,
        emissive: 0xff3b18,
        emissiveIntensity: 0.3,
      });

      const rig = new THREE.Group();
      const arms: import("three").Group[] = [];

      for (let i = 0; i < BLADES; i += 1) {
        const arm = new THREE.Group();
        // One blade catches the safelight. The rest stay in shadow — the same
        // idea as the mark, and the reason the accent never feels sprayed on.
        const blade = new THREE.Mesh(geometry, i === 0 ? lit : ink);
        blade.position.set(1.02, 0, 0);
        arm.add(blade);
        arm.rotation.z = (i / BLADES) * Math.PI * 2;
        rig.add(arm);
        arms.push(arm);
      }
      scene.add(rig);

      scene.add(new THREE.AmbientLight(0xffffff, 0.55));
      const key = new THREE.DirectionalLight(0xffffff, 1.5);
      key.position.set(3, 4, 5);
      scene.add(key);
      const glow = new THREE.PointLight(0xff3b18, 4, 12);
      glow.position.set(0, 0, 1.6);
      scene.add(glow);

      let raf = 0;
      let current = target.current;

      const resize = () => {
        const s = size();
        renderer.setSize(s, s, false);
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host);

      const frame = () => {
        // Ease toward the scroll target rather than snapping to it, so a fast
        // flick reads as the iris catching up rather than teleporting.
        current += (target.current - current) * (reduced ? 1 : 0.075);

        // `current` is how open the iris is. Closed pushes the blades inward
        // and twists them across each other; open swings them back to the ring.
        const shut = 1 - current;
        arms.forEach((arm, i) => {
          const base = (i / BLADES) * Math.PI * 2;
          arm.rotation.z = base + shut * 0.62;
          const blade = arm.children[0] as import("three").Mesh;
          blade.position.x = 1.02 - shut * 0.5;
        });

        glow.intensity = 1.4 + current * 6;
        if (!reduced) rig.rotation.z += 0.0009;

        renderer.render(scene, camera);
        raf = requestAnimationFrame(frame);
      };
      frame();

      cleanup = () => {
        cancelAnimationFrame(raf);
        observer.disconnect();
        geometry.dispose();
        ink.dispose();
        lit.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  return (
    <div className="iris" ref={mount} aria-hidden="true">
      {webgl === false ? <IrisFallback open={target.current} /> : null}
    </div>
  );
}

/**
 * The same six blades in SVG. Shown when WebGL is unavailable — this has to be
 * handsome on its own, because someone judging on a locked-down laptop should
 * never see a hole where the idea was.
 */
function IrisFallback({ open }: { open: number }) {
  const R = 50;
  const inner = R * Math.max(0.16, open);
  const cx = 64;
  const cy = 64;
  const point = (angle: number, r: number) =>
    `${(cx + Math.cos(angle) * r).toFixed(1)} ${(cy + Math.sin(angle) * r).toFixed(1)}`;

  return (
    <svg viewBox="0 0 128 128" className="iris-svg" role="presentation">
      {Array.from({ length: BLADES }, (_, i) => {
        const a = (i / BLADES) * Math.PI * 2;
        const b = ((i + 1) / BLADES) * Math.PI * 2;
        return (
          <path
            key={i}
            d={`M${point(a, R)}L${point(b, R)}L${point(b, inner)}Z`}
            fill={i === 0 ? "var(--safelight)" : "var(--ink)"}
            opacity={i === 0 ? 1 : 0.3 + i * 0.09}
          />
        );
      })}
    </svg>
  );
}
