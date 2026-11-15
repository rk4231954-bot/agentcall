# agentcall

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
