"use client";

import { useEffect } from "react";

// One observer for the whole page: marks [data-reveal] elements once they
// enter the viewport and pauses SMIL animations that are off screen.
export function RevealObserver() {
  useEffect(() => {
    const html = document.documentElement;
    html.dataset.js = "1";
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const reveal = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          (e.target as HTMLElement).dataset.in = "1";
          reveal.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.15 },
    );
    const smil = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const svg = e.target as SVGSVGElement;
        if (e.isIntersecting && !reduced) svg.unpauseAnimations();
        else svg.pauseAnimations();
      }
    });

    document.querySelectorAll<HTMLElement>("[data-reveal]").forEach((el) => {
      if (reduced) el.dataset.in = "1";
      else reveal.observe(el);
    });
    document.querySelectorAll<SVGSVGElement>("svg[data-smil]").forEach((svg) => smil.observe(svg));

    return () => {
      reveal.disconnect();
      smil.disconnect();
    };
  }, []);
  return null;
}
