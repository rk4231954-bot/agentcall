import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { GitHubIcon } from "@/components/brand-icons";
import { Logo } from "@/components/logo";
import { SpaceTile } from "@/components/space/space-tile";

export const REPO_URL = "https://github.com/rk4231954-bot/agentcall";
export const AUTHOR = { name: "Kiran", username: "rk4231954-bot", url: "https://github.com/rk4231954-bot" };

export function Nav() {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 bg-gradient-to-b from-black/90 via-black/40 to-transparent">
      <nav className="pointer-events-auto mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <a href="#" className="flex items-center gap-2 text-sm font-semibold tracking-tight text-white">
          <Logo size={30} />
          agentcall
        </a>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-full border border-white/10 px-3.5 py-1.5 text-sm text-neutral-300 transition-colors hover:border-white/25 hover:text-white"
        >
          <GitHubIcon size={16} />
          <span className="hidden sm:inline">GitHub</span>
        </a>
      </nav>
    </header>
  );
}

export function FinalCta() {
  return (
    <section data-reveal className="reveal flex flex-col items-center px-6 pb-28 pt-8 text-center md:pb-36">
      <SpaceTile kind="blackhole" className="-my-10 aspect-[16/9] w-[min(92vw,640px)]" />
      <h2 className="mt-4 max-w-2xl text-balance text-3xl font-semibold tracking-tight text-white md:text-5xl">
        Put agents on your team.
      </h2>
      <p className="mt-4 max-w-md text-pretty text-neutral-400">
        Open source. Bring the agents you already use and let them pick up the work.
      </p>
      <a
        href={REPO_URL}
        target="_blank"
        rel="noreferrer"
        className="cta mt-8 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-medium text-black transition-transform active:scale-[0.97]"
      >
        <GitHubIcon size={16} />
        View on GitHub
        <HugeiconsIcon icon={ArrowUpRight01Icon} size={16} strokeWidth={2} />
      </a>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-white/[0.06]">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-neutral-500 sm:flex-row">
        <span className="flex items-center gap-2 text-neutral-300">
          <Logo size={20} />
          agentcall
        </span>
        <p>
          Made by <span className="text-neutral-300">{AUTHOR.name}</span> ·{" "}
          <a href={AUTHOR.url} target="_blank" rel="noreferrer" className="text-neutral-300 hover:text-gold">
            @{AUTHOR.username}
          </a>
        </p>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 text-neutral-300 transition-colors hover:text-white"
        >
          <GitHubIcon size={16} />
          GitHub
        </a>
      </div>
    </footer>
  );
}
