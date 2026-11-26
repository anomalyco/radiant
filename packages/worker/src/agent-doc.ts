// Content negotiation and agent-first Markdown onboarding guide for Radiant.

export const MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8"

export const prefersMarkdown = (accept: string | null): boolean => {
  if (!accept || accept.trim() === "") return true
  let markdown = 0
  let html = 0
  let plain = 0
  let hasHtml = false

  for (const part of accept.split(",")) {
    const [rawType, ...params] = part.trim().toLowerCase().split(";")
    const type = rawType?.trim() ?? ""
    const qParam = params.map((p) => p.trim()).find((p) => p.startsWith("q="))
    const q = qParam ? Number(qParam.slice(2)) : 1
    if (!Number.isFinite(q) || q <= 0) continue

    if (type === "text/markdown" || type === "text/x-markdown") {
      markdown = Math.max(markdown, q)
    } else if (type === "text/html" || type === "application/xhtml+xml") {
      html = Math.max(html, q)
      hasHtml = true
    } else if (type === "text/plain") {
      plain = Math.max(plain, q)
    }
  }

  if (markdown > 0 && markdown >= html) return true
  if (plain > 0 && !hasHtml) return true
  if (!hasHtml) return true
  return false
}

export const markdownResponse = (markdown: string, status = 200): Response =>
  new Response(markdown, {
    status,
    headers: {
      "content-type": MARKDOWN_CONTENT_TYPE,
      vary: "Accept",
      "cache-control": "public, max-age=60",
    },
  })

const TEMPLATE = "# Radiant\n\nAgent-native financial data hub: connect bank accounts through Plaid, sync lossless raw data into PlanetScale MySQL, apply non-destructive overlays and reclassification rules with instant non-LIFO undo, and run structured aggregations or read-only SQL over HTTP or MCP.\n\n- **Web UI:** {{base}}\n- **MCP endpoint (Streamable HTTP, OAuth 2.1):** `{{base}}/mcp`\n- **REST API:** `{{base}}/api/v1/*`\n- **Markdown guide:** `{{base}}/index.md` (or `Accept: text/markdown` on `{{base}}`)\n\n---\n\n## Agent Onboarding Flow\n\nIf a user gave you this link and asked to set up or use Radiant, do as much of the work for them as possible. Follow these steps in order:\n\n### Step 1 — Sign the user in (Device Flow, RFC 8628)\n\nStart a device sign-in session. Show the user `verification_uri_complete` and `user_code` so they can open one link, sign in with their Anomaly account, and click **Approve**.\n\n```http\nPOST {{base}}/api/v1/auth/device\nContent-Type: application/json\n\n{\"client_name\": \"<your agent name, e.g. OpenCode>\"}\n```\n\nResponse:\n```json\n{\n  \"device_code\": \"rdd1.…\",\n  \"user_code\": \"BCDF-GHJK\",\n  \"verification_uri\": \"{{base}}/device\",\n  \"verification_uri_complete\": \"{{base}}/device?code=BCDF-GHJK\",\n  \"expires_in\": 600,\n  \"interval\": 5\n}\n```\n\nPoll `/api/v1/auth/token` every `interval` seconds until approved (`authorization_pending` means keep waiting; stop on `access_denied`, `expired_token`, or `invalid_grant`):\n\n```http\nPOST {{base}}/api/v1/auth/token\nContent-Type: application/json\n\n{\"grant_type\": \"urn:ietf:params:oauth:grant-type:device_code\", \"device_code\": \"rdd1.…\"}\n```\n\nOnce approved, you receive `access_token` (`rdm1.…`, 1h TTL) and `refresh_token` (`rdr1.…`, 30d TTL, rotates on every refresh at `POST {{base}}/oauth/token`). Use `Authorization: Bearer <access_token>` for both `/api/v1/*` and `/mcp`.\n\n### Step 2 — Pick or create a workspace\n\nList the user's workspaces first. If they have none, create one (e.g. `Personal` or ask what name they want).\n\n```http\nGET {{base}}/api/v1/workspaces\nAuthorization: Bearer <access_token>\n```\n\n```http\nPOST {{base}}/api/v1/workspaces\nAuthorization: Bearer <access_token>\nContent-Type: application/json\n\n{\"name\": \"Personal\", \"currency\": \"USD\"}\n```\n\nTo invite a collaborator (partner, teammate, accountant) to the workspace, mint an invite deep link and share `invite_url`:\n\n```http\nPOST {{base}}/api/v1/workspaces/<workspace_id>/invites\nAuthorization: Bearer <access_token>\nContent-Type: application/json\n\n{\"email\": \"partner@example.com\", \"role\": \"member\"}\n```\n\n### Step 3 — Give the user a 1-click deep link to connect bank accounts\n\nAgents never touch bank credentials. Instead, mint a short-lived Plaid Link deep link and hand `connect_url` to the user. Opening `connect_url` auto-launches Plaid Link immediately and lets them connect one or more banks in a single browser visit (valid 15 minutes):\n\n```http\nPOST {{base}}/api/v1/workspaces/<workspace_id>/plaid/connect-link\nAuthorization: Bearer <access_token>\nContent-Type: application/json\n\n{\"mode\": \"new\"}\n```\n\nResponse:\n```json\n{\n  \"connect_url\": \"{{base}}/connect/rdl1_…\",\n  \"workspace_id\": \"ws_…\",\n  \"mode\": \"new\",\n  \"expires_at\": \"…\"\n}\n```\n\nFor re-authenticating an expired bank connection (`status: \"needs_reauth\"`), pass `{\"mode\": \"update\", \"item_id\": \"<item_id>\"}`.\n\nCheck connected institutions and accounts after the user finishes linking:\n\n```http\nGET {{base}}/api/v1/workspaces/<workspace_id>/plaid/items\nGET {{base}}/api/v1/workspaces/<workspace_id>/accounts\nGET {{base}}/api/v1/workspaces/<workspace_id>/balances\n```\n\n### Step 4 — Connect the MCP server (recommended for ongoing use)\n\nAdd Radiant as a remote MCP server (supports OAuth 2.1 with PKCE and dynamic client registration) — or mint a workspace-scoped API token via `POST {{base}}/api/v1/workspaces/<workspace_id>/tokens`:\n\n```json\n{\n  \"mcp\": {\n    \"radiant\": {\n      \"type\": \"remote\",\n      \"url\": \"{{base}}/mcp\"\n    }\n  }\n}\n```\n\n---\n\n## Querying, Overlays, Rules & Undo\n\n- **Sign convention:** Effective transactions use standard accounting sign (`-` outflow / spending, `+` inflow / income) in integer minor units (`amount_cents`; `amount = amount_cents / 100.0`). Raw Plaid data (`raw_transactions`) is immutable.\n- **Structured queries & aggregations:**\n  - `POST {{base}}/api/v1/workspaces/<ws>/transactions/query` — filters (date, accounts, prefix categories, merchants, search, tags, transfers, splits) + keyset cursor pagination.\n  - `POST {{base}}/api/v1/workspaces/<ws>/transactions/aggregate` — split-aware multi-dimension `group_by` (`day`/`week`/`month`/`quarter`/`year`, `category`, `category_top`, `merchant_name`, `account_id`, `tag`, …) + `compare_previous_period`.\n- **Standard SQL (read-only MySQL):**\n  - `GET {{base}}/api/v1/workspaces/<ws>/sql/schema` — inspect curated views (`transactions`, `transactions_unsplit`, `splits`, `raw_transactions`, `accounts`, `balance_snapshots`, `rules`, `overlay_batches`).\n  - `POST {{base}}/api/v1/workspaces/<ws>/sql/query` — run `SELECT` / `WITH` queries with CTEs, window functions, and joins (automatically workspace-isolated on a read-only DB role).\n- **Non-destructive overlays & splits:**\n  - `POST {{base}}/api/v1/workspaces/<ws>/transactions/overlay` — patch 1 or many transactions by `tx_ids` or `filter` (supports `dry_run: true`).\n  - `PUT {{base}}/api/v1/workspaces/<ws>/transactions/<tx_id>/splits` — split a transaction into lines summing to the parent amount.\n  - `POST {{base}}/api/v1/workspaces/<ws>/transactions/manual` — add an off-Plaid/cash entry.\n- **Declarative rules (automatic future + retroactive reclassification):**\n  - `POST {{base}}/api/v1/workspaces/<ws>/rules/preview` — dry-run match AST + actions and inspect sample before/after diffs before creating.\n  - `POST {{base}}/api/v1/workspaces/<ws>/rules` — create a prioritized rule.\n- **Instant non-LIFO undo & redo:**\n  - Every edit, bulk overlay, split, manual entry, or rule change returns a `batch_id`.\n  - `GET {{base}}/api/v1/workspaces/<ws>/overlays/batches` — inspect change history.\n  - `POST {{base}}/api/v1/workspaces/<ws>/overlays/batches/<batch_id>/undo` (or `/redo`) — efficiently reverts any batch out of order in O(affected rows).\n"

export const renderAgentMarkdown = (baseUrl: string): string =>
  TEMPLATE.replaceAll("{{base}}", baseUrl.replace(/\/+$/, ""))
