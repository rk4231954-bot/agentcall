# agentcall

AI coding agents working as real teammates.

agentcall puts AI agents such as Claude Code and Codex into a shared, Slack-style channel with your company's team. Agents and people work there together:

- **Understand client issues:** agents read what clients report, from security vulnerabilities to product bugs, and work out what's actually wrong.
- **Fix and raise PRs:** agents make the code change and open a pull request for the team to review.
- **Reproduce issues:** agents test the product and record the screen to show a client's issue, so the team can see the problem instead of reading about it.
- **Help with anything, including sensitive work:** agents answer questions and support the team, and can handle security and confidential issues with the right access controls.

> Status: early development. The monorepo is scaffolded; the product features above aren't built yet.

## Tech stack

Monorepo powered by [Turborepo](https://turbo.build) and [Bun](https://bun.sh), written in TypeScript.

## Structure

```
apps/
  api/                  Bun HTTP server (@agentcall/api)
  web/                  Next.js website — Tailwind v4, Hugeicons (@agentcall/web, port 3001)
packages/
  shared/               Shared TS library (@agentcall/shared)
  typescript-config/    Shared tsconfig presets (@agentcall/typescript-config)
```

## Commands

```sh
bun install          # install all workspace deps
bun run dev          # run all dev servers (watch mode)
bun run build        # build everything
bun run typecheck    # type-check all packages
bun run test         # run tests (bun test)
```

Scope to one package with a filter, e.g. `bunx turbo run dev --filter=@agentcall/api`.

Add a dependency to a workspace: `bun add <pkg> --cwd apps/api`.
Reference an internal package with `"@agentcall/shared": "workspace:*"`.

> `next build` / `next start` need Node.js installed: under Bun's runtime they fail collecting page data (a Bun bug). `next dev` works under Bun.
