import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { exportJWK, generateKeyPair, SignJWT } from "jose"
import {
  applyTransactionOverlay,
  balancesSummary,
  createRule,
  createWorkspace,
  exchangePublicToken,
  getTransactionDetail,
  queryTransactions,
  sha256Hex,
  triggerPlaidSync,
  upsertOidcUser,
  verifyPlaidWebhook,
  type Actor,
} from "../src"
import { makePlaidTx, makeTestLayer, type MockPlaidState } from "./support/test-db"

describe("Plaid Sync Engine — cursor pagination, mutation retry, pending->posted carry-forward & webhooks", () => {
  test("syncs accounts/balances, retries mutation-during-pagination, carries overlays from pending to posted, and handles removals", async () => {
    const state: MockPlaidState = {
      institutionName: "Chase",
      itemId: "item_chase_1",
      accessToken: "access-sandbox-secret-xyz",
      webhookKeys: {},
      accounts: [
        {
          account_id: "plaid_acc_chk",
          name: "Checking",
          official_name: "Chase Total Checking",
          mask: "1234",
          type: "depository",
          subtype: "checking",
          balances: { current: 5400.25, available: 5300.0, limit: null, iso_currency_code: "USD" },
        },
        {
          account_id: "plaid_acc_cc",
          name: "Sapphire",
          official_name: "Chase Sapphire Reserve",
          mask: "9999",
          type: "credit",
          subtype: "credit card",
          balances: { current: 400.25, available: null, limit: 25000, iso_currency_code: "USD" },
        },
      ],
      syncPages: [
        // Initial sync: 2 pages, with first page hitting a mutation retry cleanly
        {
          added: [
            makePlaidTx({
              transaction_id: "ptx_pending_1",
              account_id: "plaid_acc_cc",
              amount: 12.75,
              name: "BLUE BOTTLE COFFEE",
              merchant_name: "Blue Bottle",
              pending: true,
              date: "2026-11-18",
            }),
          ],
          modified: [],
          removed: [],
          next_cursor: "cur_partial",
          has_more: true,
        },
        {
          errorCode: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
          message: "Cursor mutated during pagination",
        },
        // Restarted from committed cursor -> succeeds!
        {
          added: [
            makePlaidTx({
              transaction_id: "ptx_pending_1",
              account_id: "plaid_acc_cc",
              amount: 12.75,
              name: "BLUE BOTTLE COFFEE",
              merchant_name: "Blue Bottle",
              pending: true,
              date: "2026-11-18",
            }),
            makePlaidTx({
              transaction_id: "ptx_payroll_1",
              account_id: "plaid_acc_chk",
              amount: -5000.0, // Plaid negative = inflow
              name: "ACME PAYROLL",
              merchant_name: "Acme",
              pending: false,
              date: "2026-11-15",
              personal_finance_category: { primary: "INCOME", detailed: "INCOME_WAGES" },
            }),
          ],
          modified: [],
          removed: [],
          next_cursor: "cur_v1",
          has_more: false,
        },
        // Second sync: pending_1 settles into posted_1, and payroll_1 gets removed (simulating bank reversal)
        {
          added: [
            makePlaidTx({
              transaction_id: "ptx_posted_1",
              account_id: "plaid_acc_cc",
              amount: 12.75,
              name: "BLUE BOTTLE COFFEE #09",
              merchant_name: "Blue Bottle",
              pending: false,
              pending_transaction_id: "ptx_pending_1",
              date: "2026-11-19",
            }),
          ],
          modified: [],
          removed: [{ transaction_id: "ptx_payroll_1" }],
          next_cursor: "cur_v2",
          has_more: false,
        },
      ],
    }

    const layer = makeTestLayer(state)
    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const u = yield* upsertOidcUser({ issuer: "iss", sub: "s1", email: "dax@anoma.ly", name: "Dax" })
          const actor: Actor = { type: "user", userId: u.id, email: u.email, name: u.name, clientName: "web" }
          const ws = yield* createWorkspace(actor, { name: "Main" })

          // Create a rule BEFORE syncing -> should automatically run during initial sync!
          yield* createRule(actor, ws.id, {
            name: "Coffee tagger",
            match: { field: "raw_name", op: "icontains", value: "blue bottle" },
            actions: { add_tags: ["caffeine"] },
          })

          // Exchange public token + initial sync
          const linked = yield* exchangePublicToken(actor, ws.id, { public_token: "public-sandbox-1" })
          expect(linked.accounts_count).toBe(2)
          expect(linked.sync.added).toBe(2)

          // Verify net worth: Checking $5400.25 - Credit $400.25 = $5000.00 (500000 cents)
          const bal = yield* balancesSummary(actor, ws.id)
          expect(bal.by_currency.USD!.net_worth_cents).toBe(500000)

          // Verify sign normalization: coffee outflow = -1275, payroll inflow = +500000
          const q1 = yield* queryTransactions(actor, ws.id, { include_provenance: true })
          expect(q1.items.length).toBe(2)
          const pendingCoffee = q1.items.find((t) => t.raw_name.includes("BLUE BOTTLE"))!
          const payroll = q1.items.find((t) => t.raw_name.includes("PAYROLL"))!
          expect(pendingCoffee.amount_cents).toBe(-1275)
          expect(pendingCoffee.tags).toEqual(["caffeine"])
          expect(payroll.amount_cents).toBe(500000)

          // User edits the PENDING coffee transaction
          yield* applyTransactionOverlay(actor, ws.id, {
            tx_ids: [pendingCoffee.id],
            patch: { category: "Work > Coffee Meetings", notes: "met with Kit" },
            reason: "Tag client meeting",
          })

          // Trigger second sync: pending -> posted settlement + removal
          const sync2 = yield* triggerPlaidSync(actor, ws.id, { item_id: state.itemId })
          expect(sync2.results[0]!.added).toBe(1)
          expect(sync2.results[0]!.removed).toBe(1)

          // Only the posted coffee should remain active (superseded pending + removed payroll are excluded!)
          const q2 = yield* queryTransactions(actor, ws.id, { include_provenance: true })
          expect(q2.items.length).toBe(1)
          const posted = q2.items[0]!
          expect(posted.pending).toBe(false)
          expect(posted.category).toBe("Work > Coffee Meetings")
          expect(posted.notes).toBe("met with Kit")
          expect(posted.tags).toEqual(["caffeine"])

          const detail = yield* getTransactionDetail(actor, ws.id, posted.id)
          expect(detail.raw?.raw_amount_cents).toBe(1275) // Raw Plaid sign preserved losslessly!
        }),
        layer,
      ),
    )
  })

  test("verifies Plaid ES256 webhook JWT and rejects tampered body", async () => {
    const { publicKey, privateKey } = await generateKeyPair("ES256")
    const jwk = await exportJWK(publicKey)
    const kid = "plaid-kid-1"

    const body = JSON.stringify({
      webhook_type: "TRANSACTIONS",
      webhook_code: "SYNC_UPDATES_AVAILABLE",
      item_id: "item_1",
    })
    const bodyHash = await Effect.runPromise(sha256Hex(body))
    const jwt = await new SignJWT({ request_body_sha256: bodyHash })
      .setProtectedHeader({ alg: "ES256", kid })
      .setIssuedAt()
      .sign(privateKey)

    const layer = makeTestLayer({
      institutionName: "Chase",
      itemId: "item_1",
      accessToken: "tok",
      accounts: [],
      syncPages: [],
      webhookKeys: { [kid]: jwk as Record<string, unknown> },
    })

    const valid = await Effect.runPromise(
      Effect.provide(verifyPlaidWebhook(body, jwt), layer),
    )
    expect(valid.webhook_code).toBe("SYNC_UPDATES_AVAILABLE")

    const tampered = await Effect.runPromise(
      Effect.provide(Effect.result(verifyPlaidWebhook(body + " ", jwt)), layer),
    )
    expect(tampered._tag).toBe("Failure")
  })
})
