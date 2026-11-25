import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  createManualTransaction,
  createWorkspace,
  executeWorkspaceSql,
  rewriteWorkspaceSql,
  upsertOidcUser,
  type Actor,
} from "../src"
import { makeTestLayer } from "./support/test-db"

describe("SqlGuard — AST validation & workspace isolation", () => {
  test("rewrites simple SELECT, JOIN, CTE, and user params in exact order", async () => {
    const rewritten = await Effect.runPromise(
      rewriteWorkspaceSql({
        sql: "WITH big AS (SELECT * FROM transactions WHERE amount_cents < ?) SELECT b.merchant_name, a.name FROM big b JOIN accounts a ON a.id = b.account_id WHERE b.date >= ?",
        workspaceId: "ws_alpha",
        userParams: [-5000, "2026-01-01"],
        limit: 50,
      }),
    )

    expect(rewritten.limit).toBe(50)
    // transactions has 2 workspace_id params, user param 1 (-5000), accounts has 1 workspace_id param, user param 2 ("2026-01-01")
    expect(rewritten.params).toEqual(["ws_alpha", "ws_alpha", -5000, "ws_alpha", "2026-01-01"])
    expect(rewritten.sql).toContain("LIMIT 50")
    expect(rewritten.sql).toContain("WHERE et.workspace_id = ?")
  })

  test("rejects DML, DDL, multi-statements, system schemas, secrets tables, comments, and dangerous functions", async () => {
    const attacks = [
      "DELETE FROM transactions",
      "UPDATE transactions SET amount_cents = 0",
      "INSERT INTO transactions VALUES (1)",
      "DROP TABLE raw_transaction",
      "SELECT 1; DROP TABLE user",
      "SELECT * FROM plaid_credential",
      "SELECT * FROM user",
      "SELECT * FROM oauth_grant",
      "SELECT * FROM information_schema.tables",
      "SELECT * FROM mysql.user",
      "SELECT SLEEP(5) FROM transactions",
      "SELECT LOAD_FILE('/etc/passwd')",
      "SELECT * FROM transactions FOR UPDATE",
      "SELECT * FROM transactions INTO OUTFILE '/tmp/x'",
      "SELECT /*!50000 1 */ FROM transactions",
      "SELECT @@version",
      "SELECT * FROM radiant.transactions",
    ]

    for (const sql of attacks) {
      const res = await Effect.runPromise(
        Effect.result(rewriteWorkspaceSql({ sql, workspaceId: "ws_alpha" })),
      )
      expect(res._tag).toBe("Failure")
    }
  })

  test("enforces strict cross-workspace isolation on real SQL execution", async () => {
    const layer = makeTestLayer()
    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const uA = yield* upsertOidcUser({ issuer: "iss", sub: "a", email: "a@test.com", name: "A" })
          const uB = yield* upsertOidcUser({ issuer: "iss", sub: "b", email: "b@test.com", name: "B" })
          const actorA: Actor = { type: "user", userId: uA.id, email: uA.email, name: uA.name, clientName: "test" }
          const actorB: Actor = { type: "user", userId: uB.id, email: uB.email, name: uB.name, clientName: "test" }

          const wsA = yield* createWorkspace(actorA, { name: "Alpha" })
          const wsB = yield* createWorkspace(actorB, { name: "Beta" })

          yield* createManualTransaction(actorA, wsA.id, {
            date: "2026-11-01",
            amount_cents: -4200,
            description: "Alpha Secret Coffee",
            category: "Food",
          })
          yield* createManualTransaction(actorB, wsB.id, {
            date: "2026-11-01",
            amount_cents: -99900,
            description: "Beta Confidential Purchase",
            category: "Private",
          })

          const resA = yield* executeWorkspaceSql(actorA, wsA.id, {
            sql: "SELECT description, amount_cents FROM transactions ORDER BY amount_cents ASC",
          })
          expect(resA.row_count).toBe(1)
          expect(resA.rows[0]!.description).toBe("Alpha Secret Coffee")
          expect(resA.rows[0]!.amount_cents).toBe(-4200)
        }),
        layer,
      ),
    )
  })
})
