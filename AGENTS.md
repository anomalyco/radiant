# Radiant

<!-- tallow -->

Agent-native financial data hub on Cloudflare Workers, Effect v4, and PlanetScale MySQL.
Design and architecture live in [docs/plan.md](docs/plan.md).

## Layout

- `packages/database`: Drizzle MySQL schema (`src/schema.ts`) and migration runner. Migrations live in `migrations/`.
- `packages/core`: Pure Effect domain services (workspaces, OAuth/OIDC, Plaid sync, rules AST, 3-layer materializer, overlays & non-LIFO undo, structured query/aggregate builder, SQL AST guard & workspace rewriter). No HTTP details here.
- `packages/worker`: Cloudflare Worker entrypoint (REST `/api/v1/*`, stateless Streamable HTTP MCP `/mcp`, OAuth 2.1 `/oauth/*` + `/.well-known/*`, `/webhooks/plaid`, the web app's shell and static files, sync queue consumer, daily cron).
- `packages/web`: The web app, Solid + Vite on `@opencode/ui`, styled after anomalyco/release's admin page. It covers setup only (accounts and connections, rules, activity and undo, members, tokens, MCP); transactions are read and edited over MCP. The Worker serves `dist/` from its `ASSETS` binding and writes each page's data into `index.html` (`src/shell.ts`, `packages/web/src/boot.ts`).

## Commands

- `bun install --frozen-lockfile`
- `bun run check`: typecheck, run tests, and build the web app and Worker.
- `bun run --cwd packages/web build`: build the web app; the Worker build needs it first.
- `bun run db:generate`: generate Drizzle MySQL migration from `packages/database/src/schema.ts`.
- `bun run db:migrate`: apply migrations to `DATABASE_URL`.

## Conventions

- `dev` is the default branch. `production` moves only by `git push origin dev:production`.
- Changes under `.github/` require review from `@thdxr`.
- Never mutate `raw_*` Plaid tables from user/agent/rule operations. All edits go through `overlay_batch` so any edit can be undone non-LIFO in O(affected rows).
- `raw_transaction.raw_amount_cents` keeps Plaid's sign (`+` outflow); `effective_transaction.amount_cents` uses standard accounting sign (`-` outflow / `+` inflow).
- `sql_query` must always run through `SqlGuard` (AST validation + workspace-scoped derived-table rewriting) on `DATABASE_READ_URL`.
- Validate unknown input once at the boundary with Effect `Schema`, then pass concrete types inward.
- Keep dependencies minimal and pinned to exact versions.
