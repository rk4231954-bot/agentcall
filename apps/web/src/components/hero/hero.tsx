"use client";

import { useEffect, useRef, useState } from "react";
import { ClaudeIcon, CodexIcon, OpenCodeIcon, SlackIcon } from "@/components/brand-icons";
import { createEngine, detectTier } from "./engine";

const CAPTIONS = [
  { from: 0.16, to: 0.42, title: "A client reports an issue.", body: "It lands in your Slack channel." },
  { from: 0.44, to: 0.68, title: "Agents pull it apart.", body: "They reproduce it, read the code and find the cause." },
  { from: 0.7, to: 1.01, title: "And turn it into a fix.", body: "A PR, a screen recording and a reply in the thread." },
];

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const windowed = (p: number, from: number, to: number) =>
  smooth(from, from + 0.06, p) * (1 - smooth(to - 0.06, to, p));

export function Hero() {
  const rootRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const introRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const captionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;

    const engine = createEngine(canvas, detectTier());
    if (!engine) setFallback(true);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let target = 0;
    let current = 0;
    let lastDrawn = -1;
    let time = 0;
    let last = performance.now();
    let raf = 0;
    let running = false;

    const readScroll = () => {
      const r = root.getBoundingClientRect();
      const total = r.height - window.innerHeight;
      target = total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 0;
    };

    const paintOverlay = (p: number) => {
      const intro = introRef.current;
      if (intro) {
        const o = 1 - smooth(0.02, 0.13, p);
        intro.style.opacity = String(o);
        intro.style.transform = `translate3d(0, ${(-40 * (1 - o)).toFixed(1)}px, 0)`;
        intro.style.visibility = o < 0.01 ? "hidden" : "visible";
      }
      if (hintRef.current) hintRef.current.style.opacity = String(1 - smooth(0, 0.05, p));
      if (barRef.current) barRef.current.style.transform = `scaleX(${p.toFixed(4)})`;
      CAPTIONS.forEach((c, i) => {
        const el = captionRefs.current[i];
        if (!el) return;
        const o = windowed(p, c.from, c.to);
        el.style.opacity = String(o);
        el.style.transform = `translate3d(0, ${(18 * (1 - o)).toFixed(1)}px, 0)`;
        el.style.visibility = o < 0.01 ? "hidden" : "visible";
      });
    };

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      engine?.sample(now - last);
      last = now;
      readScroll();
      // Critically damped follow: wheel steps and touch flings both glide.
      current += (target - current) * (1 - Math.exp(-dt * 7));
      if (Math.abs(target - current) < 1e-4) current = target;
      if (!reduced) time += dt * 2.6;

      if (engine && (!reduced || Math.abs(current - lastDrawn) > 1e-4)) {
        engine.render(current, time);
        lastDrawn = current;
      }
      paintOverlay(current);
      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    const io = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && !document.hidden) start();
      else stop();
    });
    io.observe(root);

    const onVisibility = () => {
      if (document.hidden) stop();
      else if (root.getBoundingClientRect().bottom > 0) start();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Only resize on real layout changes; mobile URL-bar jitter is absorbed
    // because the canvas is sized in svh.
    const ro = new ResizeObserver(() => engine?.resize());
    ro.observe(canvas);

    readScroll();
    current = target;
    paintOverlay(current);

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      engine?.dispose();
    };
  }, []);

  return (
    <section ref={rootRef} aria-label="agentcall" className="relative h-[320svh] md:h-[400svh]">
      <div className="sticky top-0 h-svh w-full overflow-hidden">
        <canvas
          ref={canvasRef}
          aria-hidden
          className={`absolute inset-0 h-full w-full ${fallback ? "hidden" : ""}`}
        />
        {fallback && <div aria-hidden className="hero-fallback absolute inset-0" />}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black to-transparent" />

        <div
          ref={introRef}
          className="absolute inset-x-0 top-0 flex flex-col items-center px-6 pt-24 text-center will-change-transform md:pt-28"
        >
          <p className="animate-rise mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-neutral-400 [animation-delay:100ms]">
            <span className="size-1.5 rounded-full bg-gold shadow-[0_0_10px_var(--color-gold)]" />
            Agents that work like teammates
          </p>
          <h1 className="animate-rise max-w-3xl text-balance text-4xl font-semibold tracking-tight text-white [animation-delay:200ms] sm:text-6xl md:text-7xl">
            Every issue pulled in. <span className="text-gold-gradient">Every fix shipped.</span>
          </h1>
          <p className="animate-rise mt-5 max-w-xl text-pretty text-base text-neutral-400 [animation-delay:320ms] md:text-lg">
            Claude Code, Codex and OpenCode join your Slack, take client issues, record the repro and open the PR.
          </p>
        </div>

        <div className="absolute inset-x-0 bottom-16 flex justify-center px-6 md:bottom-20">
          {CAPTIONS.map((c, i) => (
            <div
              key={c.title}
              ref={(el) => {
                captionRefs.current[i] = el;
              }}
              style={{ opacity: 0, visibility: "hidden" }}
              className="absolute max-w-md text-center will-change-transform"
            >
              <p className="text-2xl font-semibold tracking-tight text-white md:text-4xl">{c.title}</p>
              <p className="mt-2 text-sm text-neutral-400 md:text-base">{c.body}</p>
            </div>
          ))}
        </div>

        <div
          ref={hintRef}
          className="absolute inset-x-0 bottom-6 flex flex-col items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-neutral-500 md:bottom-8"
        >
          <div className="animate-rise mb-5 flex items-center gap-5 text-neutral-300 [animation-delay:440ms]">
            <ClaudeIcon size={22} />
            <CodexIcon size={22} />
            <OpenCodeIcon size={20} />
            <span className="h-4 w-px bg-white/15" />
            <SlackIcon size={22} />
          </div>
          Scroll
          <span className="scroll-hint h-8 w-px bg-gradient-to-b from-gold to-transparent" />
        </div>

        <div className="absolute inset-x-0 bottom-0 h-px bg-white/5">
          <div ref={barRef} className="h-full origin-left scale-x-0 bg-gold/70" />
        </div>
      </div>
    </section>
  );
}
