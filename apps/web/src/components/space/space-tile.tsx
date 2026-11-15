"use client";

import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/logo";
import { createBlackHole } from "./blackhole";
import { detectTier } from "./gl";
import { createWormhole } from "./wormhole";

type Kind = "blackhole" | "wormhole";

// Small ray-traced scenes used inside the page. The GL context is only created
// once the tile is near the viewport, and the loop only runs while it is
// visible. The black hole moves slowly, so it is held to ~30fps.
export function SpaceTile({ kind, className = "" }: { kind: Kind; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let scene: { render(t: number): void; resize(): void; dispose(): void } | null = null;
    let raf = 0;
    let visible = false;
    let last = 0;
    // The wormhole opens on the agentcall mark.
    let time = kind === "blackhole" ? 40 : 0;
    const minFrameMs = kind === "blackhole" ? 32 : 0;

    const ensure = () => {
      if (scene) return true;
      const tier = detectTier();
      if (kind === "wormhole") {
        scene = createWormhole(canvas, tier);
      } else {
        const bh = createBlackHole(canvas, tier, "tile");
        scene = bh && { render: (t) => bh.render(1, t), resize: bh.resize, dispose: bh.dispose };
      }
      if (!scene) setFallback(true);
      return !!scene;
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < minFrameMs) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      time += dt;
      scene?.render(time);
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        visible = !!entry?.isIntersecting;
        cancelAnimationFrame(raf);
        if (!visible || !ensure()) return;
        last = 0;
        if (reduced) scene?.render(time);
        else raf = requestAnimationFrame(frame);
      },
      { rootMargin: "200px" },
    );
    io.observe(canvas);

    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && visible && scene && !reduced) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    const ro = new ResizeObserver(() => {
      if (!scene) return;
      scene.resize();
      scene.render(time);
    });
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      scene?.dispose();
    };
  }, [kind]);

  return (
    <span aria-hidden className={`relative block ${className}`}>
      <canvas ref={canvasRef} className={`absolute inset-0 h-full w-full ${fallback ? "hidden" : ""}`} />
      {fallback && <Logo className="absolute inset-[22%] h-auto w-[56%]" />}
    </span>
  );
}
