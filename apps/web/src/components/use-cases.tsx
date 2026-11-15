import { HugeiconsIcon } from "@hugeicons/react";
import { GitPullRequestIcon, PlayIcon, Shield01Icon, Bug01Icon, HelpCircleIcon } from "@hugeicons/core-free-icons";
import type { ComponentType, ReactNode } from "react";
import { ClaudeIcon, CodexIcon, OpenCodeIcon, SlackIcon } from "@/components/brand-icons";

type Case = {
  tag: string;
  tagIcon: typeof Shield01Icon;
  channel: string;
  from: { name: string; initials: string };
  ask: string;
  agent: { name: string; Icon: ComponentType<{ size?: number; className?: string }> };
  reply: string;
  result: ReactNode;
};

const CASES: Case[] = [
  {
    tag: "Security",
    tagIcon: Shield01Icon,
    channel: "security",
    from: { name: "Client · Northwind", initials: "NW" },
    ask: "A researcher says our password reset links can be used twice.",
    agent: { name: "Claude Code", Icon: ClaudeIcon },
    reply: "Confirmed. Tokens weren't invalidated after use. Patched it and added a regression test.",
    result: (
      <Attachment icon={<HugeiconsIcon icon={GitPullRequestIcon} size={16} strokeWidth={1.8} />}>
        PR #218 · Invalidate reset tokens on use
      </Attachment>
    ),
  },
  {
    tag: "Bug repro",
    tagIcon: Bug01Icon,
    channel: "support",
    from: { name: "Client · Acme", initials: "AC" },
    ask: "The checkout button does nothing for me on Safari.",
    agent: { name: "Codex", Icon: CodexIcon },
    reply: "Reproduced on Safari 18. Recording attached, and the fix is up for review.",
    result: (
      <div className="flex flex-col gap-2">
        <div className="repro relative flex aspect-video items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-neutral-950">
          <span className="repro-cursor" />
          <span className="flex size-9 items-center justify-center rounded-full bg-white/10 text-white">
            <HugeiconsIcon icon={PlayIcon} size={16} strokeWidth={2} />
          </span>
          <span className="absolute bottom-2 left-2 font-mono text-[10px] text-neutral-400">repro-safari.mp4 · 0:24</span>
        </div>
        <Attachment icon={<HugeiconsIcon icon={GitPullRequestIcon} size={16} strokeWidth={1.8} />}>
          PR #219 · Fix Safari form submit
        </Attachment>
      </div>
    ),
  },
  {
    tag: "Team question",
    tagIcon: HelpCircleIcon,
    channel: "eng",
    from: { name: "Priya · Backend", initials: "PB" },
    ask: "Why did signup latency jump this morning?",
    agent: { name: "OpenCode", Icon: OpenCodeIcon },
    reply: "A migration at 09:12 locked the users table while adding an index. Suggest running it concurrently.",
    result: (
      <Attachment icon={<SlackIcon size={14} />}>Answered in thread · 3 replies</Attachment>
    ),
  },
];

function Attachment({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-gold/25 bg-gold/[0.06] px-3 py-2 text-xs text-neutral-200">
      <span className="text-gold">{icon}</span>
      <span className="truncate">{children}</span>
    </div>
  );
}

export function UseCases() {
  return (
    <div className="mx-auto grid max-w-6xl gap-4 px-6 md:grid-cols-3">
      {CASES.map((c, i) => (
        <article
          key={c.tag}
          data-reveal
          style={{ transitionDelay: `${i * 140}ms` }}
          className="reveal case-card flex flex-col rounded-2xl border border-white/[0.08] bg-[#050505] p-5"
        >
          <header className="mb-4 flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs text-neutral-400">
              <SlackIcon size={14} />#{c.channel}
            </span>
            <span className="flex items-center gap-1.5 rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-neutral-300">
              <HugeiconsIcon icon={c.tagIcon} size={12} strokeWidth={2} className="text-gold" />
              {c.tag}
            </span>
          </header>

          <div className="msg flex gap-3" style={{ transitionDelay: `${i * 140 + 250}ms` }}>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-neutral-800 text-[11px] font-semibold text-neutral-300">
              {c.from.initials}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium text-neutral-300">{c.from.name}</p>
              <p className="mt-0.5 text-sm text-neutral-100">{c.ask}</p>
            </div>
          </div>

          <div className="msg mt-4 flex gap-3" style={{ transitionDelay: `${i * 140 + 700}ms` }}>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black text-white">
              <c.agent.Icon size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-xs font-medium text-neutral-300">
                {c.agent.name}
                <span className="rounded bg-white/10 px-1 text-[9px] uppercase tracking-wide text-neutral-400">agent</span>
              </p>
              <p className="mt-0.5 text-sm text-neutral-100">{c.reply}</p>
              <div className="mt-3">{c.result}</div>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
