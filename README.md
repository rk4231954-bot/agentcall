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
  server/               Bun + Hono API, Slack/GitHub/instabox orchestration, task worker (@agentcall/server, port 3000)
  web/                  Next.js site, sign-up, onboarding, dashboard — Tailwind v4, Hugeicons, motion (@agentcall/web, port 3001)
packages/
  db/                   Drizzle schema, migrations and client — Postgres, or embedded PGlite locally (@agentcall/db)
  shared/               Shared TS library (@agentcall/shared)
  typescript-config/    Shared tsconfig presets (@agentcall/typescript-config)
```

## How it works

```
Slack mention ─┐                         ┌─> instabox VM (one per user, free plan)
Dashboard ─────┼─> server: queue (Postgres) ┤     runner.js → opencode run → git push → PR
               │   one task per user at a time    report.pdf → callbacks /api/v1/vm/runs/:id/*
GitHub ────────┘   watchdog recovers lost runs └─> Slack thread: status message, summary, PR, PDF
```

- **Sign-up** is name, email and password (argon2id). Sessions use an httpOnly cookie; only a SHA-256 of the token is stored.
- **Onboarding** connects GitHub (the agentcall GitHub App), Slack (OAuth, then the user picks the channel), an OpenCode API key and an instabox API key, then creates the first bot.
- **Secrets** (API keys, Slack bot tokens) are encrypted with AES-256-GCM using `ENCRYPTION_KEY`. Each ciphertext is bound to its owner and purpose (AAD).
- **Bots** have a name, an emoji, a purpose, skills, a model and repositories. Slack messages are routed to the bot named in the message, otherwise to the best skill match.
- **Agents** run inside the user's instabox machine. The server only orchestrates. Each run gets:
  - a GitHub installation token scoped to one repository for an hour, so commits come from the agentcall app;
  - the OpenCode key;
  - a per-run callback token.

  All three are passed as process env vars and never written to disk.
- **instabox free plan**: there is exactly one machine per user, so the runner and opencode are installed once. An activity lease keeps the machine awake during a run, and it auto-pauses when idle. Runs are capped by `TASK_TIMEOUT_MINUTES`, which stays under the plan's 120 min limit.

### API

The API lives under `/api/v1`. Every response is `{ "ok": true, "data": … }` or `{ "ok": false, "error": { "code", "message", "details"? } }`.

| Area | Endpoints |
| --- | --- |
| Auth | `POST auth/signup`, `POST auth/login`, `POST auth/logout`, `GET auth/me`, `DELETE auth/account` |
| Onboarding | `GET onboarding`, `POST onboarding/complete` |
| Integrations | `GET integrations`, `GET integrations/github/install`, `POST integrations/github/complete`, `GET integrations/github/repos`, `GET integrations/slack/install`, `POST integrations/slack/complete`, `GET integrations/slack/channels`, `PUT integrations/slack/channel`, `PUT integrations/opencode`, `GET integrations/opencode/models`, `PUT integrations/instabox`, `DELETE integrations/{github,slack,opencode,instabox}` |
| Bots | `GET/POST bots`, `GET/PATCH/DELETE bots/:id` |
| Tasks | `GET/POST tasks`, `GET tasks/:id`, `POST tasks/:id/cancel` |
| Slack | `POST slack/events` (signed) |
| VM callbacks | `POST vm/runs/:id/events`, `POST vm/runs/:id/artifacts` (per-run bearer token) |

GitHub App webhooks are received at `/github/events` and verified with `@octokit/webhooks`. `/health` is the health check.

### Configuration

See `apps/server/.env.example`. The web app needs `SERVER_URL`, which it uses to proxy `/api/v1/*` so the session cookie stays first-party.

GitHub App settings:
- **Callback URL**: `https://agentcall-web.vercel.app/callback/github`
- **Request user authorization (OAuth) during installation**: on. The callback's `code` is how the server proves an installation belongs to the user.
- **Webhook URL**: `https://agentcallserver-production.up.railway.app/github/events`
- **Repository permissions**: Contents read & write, Pull requests read & write, Metadata read.

Slack app settings:
- **Redirect URL**: `https://agentcall-web.vercel.app/callback/slack`
- **Event subscriptions**: `…/api/v1/slack/events`, with bot events `app_mention`, `message.channels` and `message.groups`.

`bun scripts/instabox-smoke.ts` (in `apps/server`, with `INSTABOX_TEST_API_KEY`) runs a real end-to-end check on instabox. It creates the machine, provisions it, runs the agent with a free model and deletes the machine.

## Commands

```sh
bun install          # install all workspace deps
bun run dev          # run all dev servers (watch mode)
bun run build        # build everything
bun run typecheck    # type-check all packages
bun run test         # run tests (bun test)
```

Scope to one package with a filter, e.g. `bunx turbo run dev --filter=@agentcall/server`.

Add a dependency to a workspace: `bun add <pkg> --cwd apps/server`.
Reference an internal package with `"@agentcall/shared": "workspace:*"`.

> `next build` / `next start` need Node.js installed: under Bun's runtime they fail collecting page data (a Bun bug). `next dev` works under Bun.

## Deploying the server (Railway)

`apps/server/Dockerfile` builds on `oven/bun:1.4.4` with the repo root as build context. It bundles the server, which runs on `oven/bun:1.4.4-slim` and applies the Drizzle migrations at startup. Attach a Railway Postgres and set `DATABASE_URL`, `ENCRYPTION_KEY`, `WEB_URL`, `PUBLIC_SERVER_URL` and the GitHub and Slack app variables.

Railway is configured with infrastructure as code in `.railway/railway.ts` (`railway.toml` is deprecated):

```sh
railway config plan    # preview changes
railway config apply   # apply them
```
