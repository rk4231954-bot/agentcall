# agentcall

Monorepo powered by [Turborepo](https://turbo.build) and [Bun](https://bun.sh), written in TypeScript.

## Structure

```
apps/
  api/                  Bun HTTP server (@agentcall/api)
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
