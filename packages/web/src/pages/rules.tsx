import { createMemo, createResource, For, Show } from "solid-js"
import { Badge } from "@opencode/ui/badge"
import { Button } from "@opencode/ui/button"
import { Switch } from "@opencode/ui/switch"
import { wsApi, wsRead } from "../api"
import type { BootWorkspace } from "../boot"
import { accountLabel, formatMoney } from "../format"
import type { Account, Rule } from "../types"
import { attempt } from "../ui/feedback"

type Props = { workspace: BootWorkspace }

interface Condition {
  readonly field?: string
  readonly op?: string
  readonly value?: unknown
  readonly all?: ReadonlyArray<Condition>
  readonly any?: ReadonlyArray<Condition>
  readonly not?: Condition
}

const FIELD: Record<string, string> = {
  raw_name: "name",
  raw_merchant_name: "merchant",
  raw_category_primary: "category",
  raw_category_detailed: "detailed category",
  amount_cents: "amount",
  account_id: "account",
  counterparty_name: "counterparty",
  payment_channel: "channel",
  day_of_week: "weekday",
}

const OP: Record<string, string> = {
  eq: "is",
  neq: "is not",
  in: "is one of",
  not_in: "is not one of",
  contains: "contains",
  icontains: "contains",
  starts_with: "starts with",
  ends_with: "ends with",
  regex: "matches",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  between: "between",
  is_null: "is empty",
}

type Names = ReadonlyMap<string, string>

const valueText = (field: string | undefined, value: unknown, names: Names): string => {
  if (Array.isArray(value)) return value.map((item) => valueText(field, item, names)).join(", ")
  if (field === "amount_cents" && typeof value === "number") return formatMoney(value)
  if (field === "account_id" && typeof value === "string") return names.get(value) ?? `…${value.slice(-6)}`
  return typeof value === "string" ? `"${value}"` : String(value)
}

/** A rule's match expression in words, e.g. name contains "venmo" and amount is -$255.00. */
export function describeMatch(node: Condition | undefined, names: Names): string {
  if (!node) return "everything"
  if (node.all) return node.all.map((child) => describeMatch(child, names)).join(" and ")
  if (node.any) return `(${node.any.map((child) => describeMatch(child, names)).join(" or ")})`
  if (node.not) return `not ${describeMatch(node.not, names)}`
  const field = node.field ? (FIELD[node.field] ?? node.field) : "?"
  const op = node.op ? (OP[node.op] ?? node.op) : "?"
  return node.op === "is_null" ? `${field} ${op}` : `${field} ${op} ${valueText(node.field, node.value, names)}`
}

const ACTION: Record<string, string> = {
  set_category: "category",
  set_merchant_name: "merchant",
  set_description: "description",
  set_notes: "notes",
  add_tags: "add tags",
  remove_tags: "remove tags",
  set_is_transfer: "transfer",
  set_is_excluded: "excluded",
  set_recurring_group: "recurring",
}

const describeActions = (actions: Readonly<Record<string, unknown>>) =>
  Object.entries(actions)
    .filter(([key]) => key !== "set_notes" && key !== "set_description" && key !== "merge_custom_fields")
    .map(([key, value]) => `${ACTION[key] ?? key} → ${Array.isArray(value) ? value.join(", ") : String(value)}`)

export function Rules(props: Props) {
  const [rules, { refetch }] = createResource(
    () => props.workspace.id,
    (id) => wsRead<{ rules: ReadonlyArray<Rule> }>(id, "/rules"),
  )
  const [accounts] = createResource(
    () => props.workspace.id,
    (id) => wsRead<{ accounts: ReadonlyArray<Account> }>(id, "/accounts?include_inactive=1"),
  )
  const names = createMemo<Names>(() => new Map((accounts()?.accounts ?? []).map((account) => [account.id, accountLabel(account)])))
  const editable = () => props.workspace.role !== "viewer"

  const setEnabled = async (rule: Rule, enabled: boolean) => {
    const ok = await attempt(
      () => wsApi(props.workspace.id, `/rules/${encodeURIComponent(rule.id)}`, { method: "PATCH", body: { enabled, reason: enabled ? "Enabled in the web app" : "Disabled in the web app" } }),
      enabled ? "Rule on" : "Rule off",
    )
    if (ok) void refetch()
  }

  const remove = async (rule: Rule) => {
    if (!confirm(`Delete "${rule.name}"? Its ${rule.match_count} transactions go back to their other rules. You can undo it from Activity.`)) return
    const ok = await attempt(() => wsApi(props.workspace.id, `/rules/${encodeURIComponent(rule.id)}`, { method: "DELETE" }), "Rule deleted")
    if (ok) void refetch()
  }

  return (
    <main class="shell fade-in">
      <div class="section-heading">
        <div class="heading-inline">
          <h1 class="page-title">Rules</h1>
          <Badge>{rules.latest?.rules.length ?? 0}</Badge>
        </div>
      </div>
      <p class="page-lede" style={{ "margin-bottom": "20px" }}>
        Rules run in priority order on every synced transaction and on history. Ask your agent to write one; it previews the matches before saving.
      </p>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Rule</th>
              <th scope="col" class="hide-narrow">
                Does
              </th>
              <th scope="col" class="num">
                Matches
              </th>
              <th scope="col" class="end">
                On
              </th>
              <th scope="col" class="end">
                <span class="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <For each={rules.latest?.rules ?? []}>
              {(rule) => (
                <tr data-dim={rule.enabled ? undefined : ""}>
                  <td>
                    <span class="rank">{rule.priority}</span>
                  </td>
                  <td style={{ "white-space": "normal" }}>
                    <span class="cell-title">
                      <strong>{rule.name}</strong>
                    </span>
                    <div class="rule-match">when {describeMatch(rule.match_json as Condition, names())}</div>
                  </td>
                  <td class="hide-narrow">
                    <span class="tags">
                      <For each={describeActions(rule.actions_json)}>{(action) => <Badge variant="subtle">{action}</Badge>}</For>
                    </span>
                  </td>
                  <td class="num muted">{rule.match_count}</td>
                  <td class="end">
                    <Switch checked={rule.enabled} disabled={!editable()} onChange={(value) => void setEnabled(rule, value)} hideLabel>
                      {rule.name}
                    </Switch>
                  </td>
                  <td class="end">
                    <Show when={editable()}>
                      <Button variant="ghost-danger" size="small" onClick={() => void remove(rule)}>
                        Delete
                      </Button>
                    </Show>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        <Show when={!rules.loading && (rules.latest?.rules.length ?? 0) === 0}>
          <p class="table-empty">No rules yet. Ask your agent, e.g. “tag every Uber Eats order as delivery”.</p>
        </Show>
      </div>
    </main>
  )
}
