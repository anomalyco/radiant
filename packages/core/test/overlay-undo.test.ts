import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  aggregateTransactions,
  applyTransactionOverlay,
  createManualTransaction,
  createRule,
  createWorkspace,
  deleteRule,
  executeWorkspaceSql,
  getTransactionDetail,
  previewRule,
  redoOverlayBatch,
  resetTransactions,
  setTransactionSplits,
  undoOverlayBatch,
  updateRule,
  upsertOidcUser,
  type Actor,
} from "../src"
import { makeTestLayer } from "./support/test-db"

describe("Overlay, Rules, Splits & Non-LIFO Undo Engine", () => {
  test("applies 3-layer precedence, non-LIFO undo/redo, rules, splits, and split-safe aggregation", async () => {
    const layer = makeTestLayer()
    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const u = yield* upsertOidcUser({ issuer: "iss", sub: "u1", email: "dax@anoma.ly", name: "Dax" })
          const actor: Actor = { type: "agent", userId: u.id, email: u.email, name: u.name, clientName: "OpenCode" }
          const ws = yield* createWorkspace(actor, { name: "Personal" })

          const t1 = yield* createManualTransaction(actor, ws.id, {
            date: "2026-11-10",
            amount_cents: -20000,
            description: "COSTCO WHOLESALE #102",
            category: "Shopping",
          })
          const t2 = yield* createManualTransaction(actor, ws.id, {
            date: "2026-11-12",
            amount_cents: -1850,
            description: "UBER EATS *ORDER 99",
            category: "Food",
          })

          // 1. Preview rule before creating (must not mutate state)
          const preview = yield* previewRule(actor, ws.id, {
            match: { field: "raw_name", op: "icontains", value: "uber eats" },
            actions: { set_category: "Dining > Delivery", set_merchant_name: "Uber Eats", add_tags: ["delivery"] },
          })
          expect(preview.matched_count).toBe(1)
          expect(preview.samples[0]!.after.category).toBe("Dining > Delivery")

          // 2. Create rule -> applies retroactively to t2
          const ruleRes = yield* createRule(actor, ws.id, {
            name: "Classify Uber Eats",
            match: { field: "raw_name", op: "icontains", value: "uber eats" },
            actions: { set_category: "Dining > Delivery", set_merchant_name: "Uber Eats", add_tags: ["delivery"] },
          })
          expect(ruleRes.affected_count).toBe(1)

          const d2AfterRule = yield* getTransactionDetail(actor, ws.id, t2.tx_id)
          expect(d2AfterRule.effective.category).toBe("Dining > Delivery")
          expect(d2AfterRule.effective.merchant_name).toBe("Uber Eats")
          expect(d2AfterRule.effective.tags).toEqual(["delivery"])
          expect(d2AfterRule.effective.provenance.category).toBe(`rule:${ruleRes.rule_id}`)

          // 3. Apply 3 chronological manual overlays (A, B, C) on t2, then undo B OUT OF ORDER (non-LIFO)!
          const batchA = yield* applyTransactionOverlay(actor, ws.id, {
            tx_ids: [t2.tx_id],
            patch: { notes: "late night dinner", tags_add: ["late"] },
            reason: "Batch A",
          })
          const batchB = yield* applyTransactionOverlay(actor, ws.id, {
            tx_ids: [t2.tx_id],
            patch: { category: "Work > Team Meals", notes: "wrong note" },
            reason: "Batch B (mistake)",
          })
          const batchC = yield* applyTransactionOverlay(actor, ws.id, {
            tx_ids: [t2.tx_id],
            patch: { tags_add: ["reimbursable"] },
            reason: "Batch C",
          })
          if (batchA.dry_run || batchB.dry_run || batchC.dry_run) throw new Error("unexpected dry_run")

          let d2 = yield* getTransactionDetail(actor, ws.id, t2.tx_id)
          expect(d2.effective.category).toBe("Work > Team Meals")
          expect(d2.effective.notes).toBe("wrong note")
          expect(d2.effective.tags).toEqual(["delivery", "late", "reimbursable"])

          // Undo B out of order -> category falls back to Rule ("Dining > Delivery"), notes fall back to A ("late night dinner"), C's tag stays!
          yield* undoOverlayBatch(actor, ws.id, batchB.batch_id)
          d2 = yield* getTransactionDetail(actor, ws.id, t2.tx_id)
          expect(d2.effective.category).toBe("Dining > Delivery")
          expect(d2.effective.notes).toBe("late night dinner")
          expect(d2.effective.tags).toEqual(["delivery", "late", "reimbursable"])
          expect(d2.effective.provenance.category).toBe(`rule:${ruleRes.rule_id}`)
          expect(d2.effective.provenance.notes).toBe(`overlay:${batchA.batch_id}`)

          // Redo B -> restored cleanly!
          yield* redoOverlayBatch(actor, ws.id, batchB.batch_id)
          d2 = yield* getTransactionDetail(actor, ws.id, t2.tx_id)
          expect(d2.effective.category).toBe("Work > Team Meals")
          expect(d2.effective.notes).toBe("wrong note")

          // 4. Reset manual overlays on t2, then undo the reset!
          const resetRes = yield* resetTransactions(actor, ws.id, [t2.tx_id])
          d2 = yield* getTransactionDetail(actor, ws.id, t2.tx_id)
          expect(d2.effective.category).toBe("Dining > Delivery") // rule still applies
          expect(d2.effective.notes).toBeNull()

          yield* undoOverlayBatch(actor, ws.id, resetRes.batch_id)
          d2 = yield* getTransactionDetail(actor, ws.id, t2.tx_id)
          expect(d2.effective.category).toBe("Work > Team Meals")
          expect(d2.effective.tags).toEqual(["delivery", "late", "reimbursable"])

          // 5. Rule update + delete + undo delete
          yield* updateRule(actor, ws.id, ruleRes.rule_id, {
            actions: { set_category: "Food > Delivery App" },
          })
          const delRule = yield* deleteRule(actor, ws.id, ruleRes.rule_id)
          yield* undoOverlayBatch(actor, ws.id, delRule.batch_id)

          // 6. Splits: reject bad sum, accept exact sum, verify SQL & aggregate never double-count!
          const badSplit = yield* Effect.result(
            setTransactionSplits(actor, ws.id, {
              tx_id: t1.tx_id,
              splits: [
                { amount_cents: -10000, category: "Groceries" },
                { amount_cents: -5000, category: "Household" },
              ],
            }),
          )
          expect(badSplit._tag).toBe("Failure")

          const splitBatch = yield* setTransactionSplits(actor, ws.id, {
            tx_id: t1.tx_id,
            splits: [
              { amount_cents: -14000, category: "Groceries" },
              { amount_cents: -6000, category: "Household" },
            ],
            reason: "Split Costco receipt",
          })

          // Aggregate should see Groceries (-14000), Household (-6000), Work > Team Meals (-1850) -> total -21850 (no double counting!)
          const agg = yield* aggregateTransactions(actor, ws.id, { group_by: ["category"] })
          expect(agg.totals.sum_cents).toBe(-21850)
          expect(agg.groups.find((g) => g.group.category === "Groceries")?.sum_cents).toBe(-14000)
          expect(agg.groups.find((g) => g.group.category === "Household")?.sum_cents).toBe(-6000)

          // SQL view 'transactions' also expands splits cleanly without double counting!
          const sqlRes = yield* executeWorkspaceSql(actor, ws.id, {
            sql: "SELECT SUM(amount_cents) AS total FROM transactions",
          })
          expect(Number(sqlRes.rows[0]!.total)).toBe(-21850)

          // Undo split -> restores Costco back to single -20000 Shopping row
          yield* undoOverlayBatch(actor, ws.id, splitBatch.batch_id)
          const aggAfterUndo = yield* aggregateTransactions(actor, ws.id, { group_by: ["category"] })
          expect(aggAfterUndo.totals.sum_cents).toBe(-21850)
          expect(aggAfterUndo.groups.find((g) => g.group.category === "Shopping")?.sum_cents).toBe(-20000)
          expect(batchC.batch_id).toBeTruthy()
        }),
        layer,
      ),
    )
  })
})
