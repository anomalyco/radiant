import { Database as SqliteDb } from "bun:sqlite"
import { Effect, Layer } from "effect"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  Database,
  DatabaseError,
  layerAuthConfig,
  layerCryptoConfig,
  PlaidClient,
  type DatabaseInterface,
  type DbExecutor,
  type PlaidAccountDto,
  type PlaidClientInterface,
  type PlaidSyncResponse,
  type PlaidTransactionDto,
  type QueryResult,
  type SqlParam,
} from "../../src"
import { PlaidApiError } from "../../src/errors"

/** Convert our Drizzle-generated MySQL migration SQL into SQLite-compatible DDL for fast in-memory tests. */
const mysqlDdlToSqlite = (mysqlSql: string): string =>
  mysqlSql
    .replace(/\bBIGINT\b/gi, "INTEGER")
    .replace(/\bINT\b/gi, "INTEGER")
    .replace(/\bBOOLEAN\b/gi, "INTEGER")
    .replace(/\bTIMESTAMP\(\d+\)/gi, "TEXT")
    .replace(/\bTIMESTAMP\b/gi, "TEXT")
    .replace(/\bJSON\b/gi, "TEXT")
    .replace(/\bVARCHAR\(\d+\)/gi, "TEXT")
    .replace(/DEFAULT \(now\(\)\)/gi, "DEFAULT CURRENT_TIMESTAMP")
    .replace(/DEFAULT CURRENT_TIMESTAMP\(\d+\)/gi, "DEFAULT CURRENT_TIMESTAMP")
    .replace(/CONSTRAINT\s+(?:`[^`]+`\s+)?PRIMARY KEY/gi, "PRIMARY KEY")
    .replace(/CONSTRAINT\s+(?:`[^`]+`\s+)?UNIQUE\s+INDEX/gi, "UNIQUE")
    .replace(/CONSTRAINT\s+(?:`[^`]+`\s+)?UNIQUE/gi, "UNIQUE")
    .replace(/\)\s*ENGINE=[^;]+;/gi, ");")

const normalizeSqliteParam = (p: SqlParam): string | number | null => {
  if (p === null) return null
  if (typeof p === "boolean") return p ? 1 : 0
  if (p instanceof Date) return p.toISOString()
  return p
}

export const createSqliteTestDatabase = (): DatabaseInterface => {
  const sqlite = new SqliteDb(":memory:")
  sqlite.exec("PRAGMA journal_mode = MEMORY;")

  const translateMysqlExpr = (s: string) => {
    let out = s.replace(/CONCAT\(' ',\s*([a-zA-Z0-9_.]+),\s*' '\)/g, "(' ' || $1 || ' ')")
    const onDupIdx = out.indexOf("ON DUPLICATE KEY UPDATE")
    if (onDupIdx !== -1 && /^\s*INSERT\s+INTO/i.test(out)) {
      out = out.slice(0, onDupIdx).replace(/^\s*INSERT\s+INTO/i, "INSERT OR REPLACE INTO")
    }
    return out
  }

  const migrationsDir = join(import.meta.dir, "../../../../migrations")
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "meta")
    .map((d) => d.name)
    .sort()

  for (const dir of dirs) {
    const raw = readFileSync(join(migrationsDir, dir, "migration.sql"), "utf8")
    const stmts = raw
      .split("--> statement-breakpoint")
      .map((s) => mysqlDdlToSqlite(s.trim()))
      .filter((s) => s.length > 0 && !/^ALTER TABLE\s+.*MODIFY COLUMN/i.test(s))
    for (const stmt of stmts) {
      sqlite.exec(stmt)
    }
  }

  const runExec = <T>(
    sql: string,
    params: ReadonlyArray<SqlParam> = [],
    isRead: boolean,
  ): Effect.Effect<QueryResult<T>, DatabaseError> =>
    Effect.try({
      try: () => {
        const bound = params.map(normalizeSqliteParam)
        const translated = translateMysqlExpr(sql)
        const trimmed = translated.trim().toUpperCase()
        if (isRead || trimmed.startsWith("SELECT") || trimmed.startsWith("WITH")) {
          const rows = sqlite.query(translated).all(...bound) as ReadonlyArray<T>
          return { rows, rowsAffected: 0 }
        }
        const info = sqlite.query(translated).run(...bound)
        return { rows: [] as ReadonlyArray<T>, rowsAffected: info.changes }
      },
      catch: (cause) =>
        new DatabaseError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    })

  const exec: DbExecutor = {
    query: <T = Record<string, unknown>>(sql: string, params?: ReadonlyArray<SqlParam>) =>
      runExec<T>(sql, params, true),
    execute: (sql: string, params?: ReadonlyArray<SqlParam>) =>
      runExec<Record<string, unknown>>(sql, params, false),
  }

  return Database.of({
    ...exec,
    queryReadOnly: exec.query,
    transaction: <A, E, R>(fn: (tx: DbExecutor) => Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        sqlite.exec("BEGIN IMMEDIATE")
        const res = yield* Effect.result(fn(exec))
        if (res._tag === "Success") {
          sqlite.exec("COMMIT")
          return res.success
        }
        sqlite.exec("ROLLBACK")
        return yield* Effect.fail(res.failure)
      }),
  })
}

export interface MockPlaidState {
  accounts: Array<PlaidAccountDto>
  syncPages: Array<PlaidSyncResponse | { errorCode: string; message: string }>
  webhookKeys: Record<string, Record<string, unknown>>
  institutionName: string
  itemId: string
  accessToken: string
}

export const makeMockPlaidLayer = (state: MockPlaidState) => {
  let syncCallIndex = 0
  const client = PlaidClient.of({
    linkTokenCreate: () =>
      Effect.succeed({ link_token: "link-sandbox-test", expiration: "2030-01-01T00:00:00Z" }),
    itemPublicTokenExchange: () =>
      Effect.succeed({ access_token: state.accessToken, item_id: state.itemId }),
    accountsGet: () =>
      Effect.succeed({
        accounts: state.accounts,
        item: {
          item_id: state.itemId,
          institution_id: "ins_mock_bank",
          consent_expiration_time: null,
          error: null,
        },
      }),
    institutionGetById: () =>
      Effect.succeed({ institution_id: "ins_mock_bank", name: state.institutionName }),
    transactionsSync: () => {
      const next = state.syncPages[syncCallIndex++]
      if (!next) {
        return Effect.succeed({
          added: [],
          modified: [],
          removed: [],
          next_cursor: `cur_${syncCallIndex}`,
          has_more: false,
        })
      }
      if ("errorCode" in next) {
        return Effect.fail(
          new PlaidApiError({ code: next.errorCode, message: next.message, retryable: true }),
        )
      }
      return Effect.succeed(next)
    },
    transactionsRefresh: () => Effect.void,
    itemRemove: () => Effect.void,
    webhookVerificationKeyGet: (kid) => {
      const key = state.webhookKeys[kid]
      return key
        ? Effect.succeed({ key })
        : Effect.fail(new PlaidApiError({ code: "INVALID_KEY_ID", message: "Unknown kid" }))
    },
  })
  return Layer.succeed(PlaidClient, client)
}

// Deterministic 32-byte base64 key for tests
export const TEST_AES_KEY_B64 = btoa("0123456789abcdef0123456789abcdef")

export const makeTestLayer = (mockPlaid?: MockPlaidState) =>
  Layer.mergeAll(
    Layer.succeed(Database, createSqliteTestDatabase()),
    layerAuthConfig({
      accountIssuer: "https://account.dev.anoma.ly",
      accountClientId: "radiant",
      sessionSecret: "test-session-secret",
    }),
    layerCryptoConfig({
      currentVersion: "v1",
      keysByVersion: { v1: TEST_AES_KEY_B64 },
    }),
    makeMockPlaidLayer(
      mockPlaid ?? {
        accounts: [],
        syncPages: [],
        webhookKeys: {},
        institutionName: "Mock Bank",
        itemId: "item_mock_1",
        accessToken: "access-sandbox-mock-1",
      },
    ),
  )

export const makePlaidTx = (overrides: Partial<PlaidTransactionDto> & { transaction_id: string; account_id: string }): PlaidTransactionDto => ({
  amount: 25.5,
  iso_currency_code: "USD",
  date: "2026-11-10",
  authorized_date: "2026-11-09",
  name: "COFFEE SHOP #42",
  merchant_name: "Blue Bottle Coffee",
  pending: false,
  pending_transaction_id: null,
  payment_channel: "in store",
  personal_finance_category: {
    primary: "FOOD_AND_DRINK",
    detailed: "FOOD_AND_DRINK_COFFEE",
    confidence_level: "HIGH",
  },
  ...overrides,
})
