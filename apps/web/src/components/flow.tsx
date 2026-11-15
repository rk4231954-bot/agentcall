import { HugeiconsIcon } from "@hugeicons/react";
import { GitPullRequestIcon, Video01Icon } from "@hugeicons/core-free-icons";
import type { ReactNode } from "react";
import { ClaudeIcon, CodexIcon, OpenCodeIcon, SlackIcon } from "@/components/brand-icons";
import { SpaceTile } from "@/components/space/space-tile";

// Trigger → agentcall → agents → results. Two hand-tuned layouts share the
// same nodes: horizontal on lg+, vertical below. Nodes are HTML positioned in
// the SVG's coordinate space, so lines and nodes always line up.

type Layout = {
  w: number;
  h: number;
  nodes: Record<NodeKey, { x: number; y: number }>;
  labels: Record<NodeKey, { x: number; y: number; align: "center" | "left" }>;
  paths: string[];
};

type NodeKey = "slack" | "hub" | "agents" | "pr" | "video" | "reply";

const DESKTOP: Layout = {
  w: 1000,
  h: 420,
  nodes: {
    slack: { x: 100, y: 190 },
    hub: { x: 370, y: 190 },
    agents: { x: 630, y: 190 },
    pr: { x: 900, y: 70 },
    video: { x: 900, y: 190 },
    reply: { x: 900, y: 310 },
  },
  labels: {
    slack: { x: 100, y: 250, align: "center" },
    hub: { x: 370, y: 270, align: "center" },
    agents: { x: 630, y: 250, align: "center" },
    pr: { x: 900, y: 112, align: "center" },
    video: { x: 900, y: 232, align: "center" },
    reply: { x: 900, y: 352, align: "center" },
  },
  paths: [
    "M134 190 L318 190",
    "M422 190 L552 190",
    "M708 190 C790 190 800 70 866 70",
    "M708 190 L866 190",
    "M708 190 C790 190 800 310 866 310",
  ],
};

const MOBILE: Layout = {
  w: 360,
  h: 800,
  nodes: {
    slack: { x: 80, y: 60 },
    hub: { x: 80, y: 230 },
    agents: { x: 80, y: 400 },
    pr: { x: 60, y: 640 },
    video: { x: 180, y: 640 },
    reply: { x: 300, y: 640 },
  },
  labels: {
    slack: { x: 128, y: 60, align: "left" },
    hub: { x: 136, y: 230, align: "left" },
    agents: { x: 150, y: 400, align: "left" },
    pr: { x: 60, y: 690, align: "center" },
    video: { x: 180, y: 690, align: "center" },
    reply: { x: 300, y: 690, align: "center" },
  },
  paths: [
    "M80 92 L80 180",
    "M80 282 L80 374",
    "M80 426 C80 530 60 540 60 608",
    "M80 426 C80 530 180 530 180 608",
    "M80 426 C80 530 300 530 300 608",
  ],
};

const LABELS: Record<NodeKey, { step?: string; title: string; body: string }> = {
  slack: { step: "01", title: "Someone asks", body: "A client reports an issue in Slack" },
  hub: { step: "02", title: "agentcall routes it", body: "One request in, the right agent out" },
  agents: { step: "03", title: "Agents work it", body: "Claude Code, Codex and OpenCode" },
  pr: { title: "Pull request", body: "With the fix and tests" },
  video: { title: "Screen recording", body: "The bug, reproduced" },
  reply: { title: "Thread reply", body: "Back where it started" },
};

function Chip({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`flow-node flex items-center justify-center rounded-2xl border border-white/10 bg-neutral-950 ${className}`}
    >
      {children}
    </span>
  );
}

function NodeVisual({ k }: { k: NodeKey }) {
  switch (k) {
    case "slack":
      return (
        <Chip className="size-14">
          <SlackIcon size={26} />
        </Chip>
      );
    case "hub":
      return <SpaceTile kind="wormhole" className="size-28 lg:size-44" />;
    case "agents":
      return (
        <Chip className="h-12 gap-3 rounded-full px-4">
          <ClaudeIcon size={22} />
          <CodexIcon size={22} />
          <OpenCodeIcon size={20} className="text-white" />
        </Chip>
      );
    case "pr":
      return (
        <Chip className="size-12 text-white">
          <HugeiconsIcon icon={GitPullRequestIcon} size={22} strokeWidth={1.6} />
        </Chip>
      );
    case "video":
      return (
        <Chip className="size-12 text-white">
          <HugeiconsIcon icon={Video01Icon} size={22} strokeWidth={1.6} />
        </Chip>
      );
    case "reply":
      return (
        <Chip className="size-12">
          <SlackIcon size={20} />
        </Chip>
      );
  }
}

const ORDER: NodeKey[] = ["slack", "hub", "agents", "pr", "video", "reply"];

function Diagram({ layout, className, compact }: { layout: Layout; className: string; compact?: boolean }) {
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  return (
    <div
      data-reveal
      className={`flow relative mx-auto w-full ${className}`}
      style={{ aspectRatio: `${layout.w} / ${layout.h}` }}
    >
      <svg
        data-smil
        viewBox={`0 0 ${layout.w} ${layout.h}`}
        className="absolute inset-0 h-full w-full overflow-visible"
        aria-hidden
      >
        <defs>
          <radialGradient id={`spark-${layout.w}`}>
            <stop offset="0" stopColor="#fff6dc" />
            <stop offset="0.35" stopColor="#f6c35b" />
            <stop offset="1" stopColor="#f6c35b" stopOpacity="0" />
          </radialGradient>
        </defs>
        {layout.paths.map((d, i) => (
          <g key={d}>
            <path d={d} className="flow-base" />
            <path
              id={`flow-${layout.w}-${i}`}
              d={d}
              pathLength={1}
              className="flow-line"
              style={{ transitionDelay: `${300 + Math.min(i, 2) * 450}ms` }}
            />
          </g>
        ))}
        <g className="flow-sparks">
          {layout.paths.map((_, i) =>
            [0, 1].map((n) => (
              <circle key={`${i}-${n}`} r={compact ? 7 : 8} fill={`url(#spark-${layout.w})`}>
                <animateMotion
                  dur={i < 2 ? "2.4s" : "2.8s"}
                  begin={`${(i < 2 ? i * 0.9 : 1.8) + n * 1.3}s`}
                  repeatCount="indefinite"
                  keyPoints="0;1"
                  keyTimes="0;1"
                  calcMode="spline"
                  keySplines="0.45 0 0.55 1"
                >
                  <mpath href={`#flow-${layout.w}-${i}`} />
                </animateMotion>
              </circle>
            )),
          )}
        </g>
      </svg>

      {ORDER.map((k, i) => {
        const n = layout.nodes[k];
        const l = layout.labels[k];
        const t = LABELS[k];
        const delay = `${150 + Math.min(i, 3) * 450}ms`;
        return (
          <div key={k}>
            <div
              className="flow-pop absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: pct(n.x, layout.w), top: pct(n.y, layout.h), transitionDelay: delay }}
            >
              <NodeVisual k={k} />
            </div>
            <div
              className={`flow-pop absolute ${compact && !t.step ? "w-28" : "w-40"} ${
                l.align === "center" ? "-translate-x-1/2 text-center" : "-translate-y-1/2 text-left"
              }`}
              style={{ left: pct(l.x, layout.w), top: pct(l.y, layout.h), transitionDelay: delay }}
            >
              {t.step && <p className="font-mono text-[11px] text-gold/80">{t.step}</p>}
              <p className="text-sm font-medium text-white">{t.title}</p>
              <p className="mt-0.5 text-xs leading-snug text-neutral-500">{t.body}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Flow() {
  return (
    <div className="px-6">
      <Diagram layout={DESKTOP} className="hidden max-w-5xl lg:block" />
      <Diagram layout={MOBILE} className="max-w-[400px] lg:hidden" compact />
    </div>
  );
}
