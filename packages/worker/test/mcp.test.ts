import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { createApiToken, createWorkspace, upsertOidcUser, type Actor } from "@radiant/core"
import { buildRouteContext } from "../src/env"
import { handleMcpRequest } from "../src/mcp"
import { makeTestLayer } from "../../core/test/support/test-db"

describe("Worker MCP Streamable HTTP endpoint (/mcp)", () => {
  test("returns 401 with RFC 9728 WWW-Authenticate when unauthenticated, and executes full MCP workflow when authenticated", async () => {
    const layer = makeTestLayer()
    const origin = "https://radiant.example"

    // 1. Unauthenticated -> 401 with resource_metadata
    const unauthReq = new Request(`${origin}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    })
    const unauthRes = await Effect.runPromise(
      Effect.provide(handleMcpRequest(unauthReq, buildRouteContext(new URL(unauthReq.url), "")), layer),
    )
    expect(unauthRes.status).toBe(401)
    expect(unauthRes.headers.get("www-authenticate")).toContain(
      "/.well-known/oauth-protected-resource/mcp",
    )

    // 2. Mint workspace token and drive MCP initialize -> tools/list -> manual tx -> rule -> sql_query -> undo
    const token = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const u = yield* upsertOidcUser({ issuer: "iss", sub: "m1", email: "dax@anoma.ly", name: "Dax" })
          const actor: Actor = { type: "user", userId: u.id, email: u.email, name: u.name, clientName: "web" }
          const ws = yield* createWorkspace(actor, { name: "MCP Test" })
          const tok = yield* createApiToken(actor, ws.id, { name: "test-agent", role: "admin" })
          return tok.token
        }),
        layer,
      ),
    )

    const callMcp = async (method: string, params?: Record<string, unknown>) => {
      const req = new Request(`${origin}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      })
      const res = await Effect.runPromise(
        Effect.provide(handleMcpRequest(req, buildRouteContext(new URL(req.url), "")), layer),
      )
      expect(res.status).toBe(200)
      return (await res.json()) as { result: Record<string, unknown> }
    }

    const init = await callMcp("initialize", { protocolVersion: "2025-11-25" })
    expect(init.result.protocolVersion).toBe("2025-11-25")

    const listed = await callMcp("tools/list")
    const tools = listed.result.tools as Array<{ name: string }>
    expect(tools.length).toBeGreaterThanOrEqual(35)

    // Create a manual tx via MCP
    const txCall = await callMcp("tools/call", {
      name: "transaction_manual_create",
      arguments: {
        date: "2026-11-20",
        amount_cents: -8500,
        description: "WHOLE FOODS MARKET",
        category: "Uncategorized",
      },
    })
    const txJson = JSON.parse((txCall.result.content as Array<{ text: string }>)[0]!.text) as { tx_id: string }
    expect(txJson.tx_id).toStartWith("tx_")

    // Create a rule via MCP
    const ruleCall = await callMcp("tools/call", {
      name: "rule_create",
      arguments: {
        name: "Whole Foods -> Groceries",
        match: { field: "raw_name", op: "icontains", value: "whole foods" },
        actions: { set_category: "Food > Groceries", set_merchant_name: "Whole Foods" },
      },
    })
    const ruleJson = JSON.parse((ruleCall.result.content as Array<{ text: string }>)[0]!.text) as { batch_id: string; affected_count: number }
    expect(ruleJson.affected_count).toBe(1)

    // Query via sql_query over MCP
    const sqlCall = await callMcp("tools/call", {
      name: "sql_query",
      arguments: {
        sql: "SELECT merchant_name, category, amount FROM transactions",
      },
    })
    const sqlJson = JSON.parse((sqlCall.result.content as Array<{ text: string }>)[0]!.text) as {
      rows: Array<{ merchant_name: string; category: string; amount: number }>
    }
    expect(sqlJson.rows[0]!.merchant_name).toBe("Whole Foods")
    expect(sqlJson.rows[0]!.category).toBe("Food > Groceries")
    expect(sqlJson.rows[0]!.amount).toBe(-85)

    // Undo the rule via MCP
    const undoCall = await callMcp("tools/call", {
      name: "overlay_undo",
      arguments: { batch_id: ruleJson.batch_id },
    })
    const undoJson = JSON.parse((undoCall.result.content as Array<{ text: string }>)[0]!.text) as { undone: boolean }
    expect(undoJson.undone).toBe(true)

    // Verify category reverted cleanly
    const sqlAfter = await callMcp("tools/call", {
      name: "sql_query",
      arguments: { sql: "SELECT category FROM transactions" },
    })
    const afterJson = JSON.parse((sqlAfter.result.content as Array<{ text: string }>)[0]!.text) as {
      rows: Array<{ category: string }>
    }
    expect(afterJson.rows[0]!.category).toBe("Uncategorized")
  })
})
