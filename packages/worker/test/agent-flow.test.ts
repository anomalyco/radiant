import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { decideDeviceFlow, upsertOidcUser } from "@radiant/core"
import { handleAppRoutes } from "../src/api"
import { buildRouteContext, type Env } from "../src/env"
import { handleOAuthRoutes } from "../src/oauth-routes"
import { makeTestLayer } from "../../core/test/support/test-db"

const MOCK_ENV: Env = {
  STAGE: "production",
  BASE_PATH: "/labs/radiant",
  ACCOUNT_ISSUER: "https://account.anoma.ly",
  ACCOUNT_CLIENT_ID: "radiant",
  PLAID_ENV: "production",
  ENCRYPTION_KEY_VERSION: "v1",
  DATABASE_URL: "mysql://unused",
  ENCRYPTION_KEY: "unused",
  SESSION_SECRET: "unused",
}

describe("Agent-driven onboarding flow & Markdown content negotiation", () => {
  test("serves Markdown to agents (Accept: text/markdown, */*, /index.md, /llms.txt) and HTML to browsers", async () => {
    const layer = makeTestLayer()
    const run = (req: Request) =>
      Effect.runPromise(
        Effect.provide(
          handleAppRoutes(req, buildRouteContext(new URL(req.url), "/labs/radiant"), MOCK_ENV),
          layer,
        ),
      )

    // 1. Accept: text/markdown -> Markdown guide with full /labs/radiant URLs
    const mdRes = await run(
      new Request("https://anoma.ly/labs/radiant", {
        headers: { accept: "text/markdown, text/html;q=0.8" },
      }),
    )
    expect(mdRes.status).toBe(200)
    expect(mdRes.headers.get("content-type")).toBe("text/markdown; charset=utf-8")
    expect(mdRes.headers.get("vary")).toBe("Accept")
    const mdText = await mdRes.text()
    expect(mdText).toContain("POST https://anoma.ly/labs/radiant/api/v1/auth/device")
    expect(mdText).toContain("POST https://anoma.ly/labs/radiant/api/v1/workspaces/<workspace_id>/plaid/connect-link")
    expect(mdText).toContain("https://anoma.ly/labs/radiant/mcp")

    // 2. Bare agent fetch (Accept: */*) -> Markdown
    const bareRes = await run(
      new Request("https://anoma.ly/labs/radiant", { headers: { accept: "*/*" } }),
    )
    expect(bareRes.headers.get("content-type")).toBe("text/markdown; charset=utf-8")

    // 3. Browser Accept: text/html -> HTML with alternate markdown link
    const htmlRes = await run(
      new Request("https://anoma.ly/labs/radiant", {
        headers: { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
      }),
    )
    expect(htmlRes.status).toBe(200)
    expect(htmlRes.headers.get("content-type")).toContain("text/html")
    const html = await htmlRes.text()
    expect(html).toContain('<link rel="alternate" type="text/markdown" href="https://anoma.ly/labs/radiant/index.md"')

    // 4. /index.md and /llms.txt always return Markdown even with browser Accept header
    for (const p of ["/labs/radiant/index.md", "/labs/radiant/llms.txt"]) {
      const r = await run(new Request(`https://anoma.ly${p}`, { headers: { accept: "text/html" } }))
      expect(r.status).toBe(200)
      expect(r.headers.get("content-type")).toBe("text/markdown; charset=utf-8")
    }
  })

  test("walks agent end-to-end: device auth -> create workspace -> mint bank connect deep link", async () => {
    const layer = makeTestLayer()
    const dispatch = (req: Request) =>
      Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const route = buildRouteContext(new URL(req.url), "/labs/radiant")
            const oauthRes = yield* handleOAuthRoutes(req, route)
            if (oauthRes) return oauthRes
            return yield* handleAppRoutes(req, route, MOCK_ENV)
          }),
          layer,
        ),
      )

    // 1. Agent starts device flow
    const devRes = await dispatch(
      new Request("https://anoma.ly/labs/radiant/api/v1/auth/device", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_name: "OpenCode" }),
      }),
    )
    expect(devRes.status).toBe(200)
    const devJson = (await devRes.json()) as {
      device_code: string
      user_code: string
      verification_uri_complete: string
    }
    expect(devJson.verification_uri_complete).toBe(
      `https://anoma.ly/labs/radiant/device?code=${encodeURIComponent(devJson.user_code)}`,
    )

    // 2. Poll before approval -> authorization_pending
    const pendingRes = await dispatch(
      new Request("https://anoma.ly/labs/radiant/api/v1/auth/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ device_code: devJson.device_code }),
      }),
    )
    expect(pendingRes.status).toBe(400)
    expect(((await pendingRes.json()) as { error: string }).error).toBe("authorization_pending")

    // 3. User signs in and approves device code
    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const u = yield* upsertOidcUser({ issuer: "iss", sub: "agent-user", email: "dax@anoma.ly", name: "Dax" })
          yield* decideDeviceFlow(devJson.user_code, u.id, true)
        }),
        layer,
      ),
    )

    // 4. Poll again -> receives Bearer access token
    const tokRes = await dispatch(
      new Request("https://anoma.ly/labs/radiant/api/v1/auth/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ device_code: devJson.device_code }),
      }),
    )
    expect(tokRes.status).toBe(200)
    const tokJson = (await tokRes.json()) as { access_token: string }
    expect(tokJson.access_token).toStartWith("rdm1.")

    // 5. Agent creates workspace
    const wsRes = await dispatch(
      new Request("https://anoma.ly/labs/radiant/api/v1/workspaces", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${tokJson.access_token}`,
        },
        body: JSON.stringify({ name: "Personal", currency: "USD" }),
      }),
    )
    expect(wsRes.status).toBe(201)
    const wsJson = (await wsRes.json()) as { id: string; slug: string }

    // 6. Agent mints 1-click bank connect deep link
    const linkRes = await dispatch(
      new Request(`https://anoma.ly/labs/radiant/api/v1/workspaces/${wsJson.id}/plaid/connect-link`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${tokJson.access_token}`,
        },
        body: JSON.stringify({ mode: "new" }),
      }),
    )
    expect(linkRes.status).toBe(200)
    const linkJson = (await linkRes.json()) as { connect_url: string }
    expect(linkJson.connect_url).toStartWith("https://anoma.ly/labs/radiant/connect/rdl1_")
  })
})
