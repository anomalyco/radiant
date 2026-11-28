import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { Avatar } from "@opencode/ui/avatar"
import { Button } from "@opencode/ui/button"
import { Switch } from "@opencode/ui/switch"
import { wsApi, wsRead } from "../api"
import type { BootWorkspace } from "../boot"
import { accountMask, accountName, formatAgo, formatMoney } from "../format"
import type { Account, PlaidItem } from "../types"
import { attempt } from "../ui/feedback"
import { openPlaid } from "../ui/plaid"

type Props = { workspace: BootWorkspace }

const canEdit = (role: BootWorkspace["role"]) => role === "owner" || role === "admin"

export function Accounts(props: Props) {
  const ws = () => props.workspace.id
  const [items, { refetch: refetchItems }] = createResource(ws, (id) => wsRead<{ items: ReadonlyArray<PlaidItem> }>(id, "/plaid/items"))
  const [accounts, { refetch: refetchAccounts }] = createResource(ws, (id) =>
    wsRead<{ accounts: ReadonlyArray<Account> }>(id, "/accounts?include_inactive=1"),
  )
  const [busy, setBusy] = createSignal<string | null>(null)
  const admin = () => canEdit(props.workspace.role)

  const refresh = () => {
    void refetchItems()
    void refetchAccounts()
  }

  const connect = async (mode: "new" | "update", itemId?: string) => {
    setBusy(itemId ?? "connect")
    await attempt(async () => {
      const { link_token } = await wsApi<{ link_token: string }>(ws(), "/plaid/link-token", { body: { mode, item_id: itemId } })
      const publicToken = await openPlaid(link_token)
      if (!publicToken) return
      await wsApi(ws(), "/plaid/exchange", { body: { public_token: publicToken } })
      refresh()
    })
    setBusy(null)
  }

  const sync = async (itemId?: string) => {
    setBusy(itemId ?? "sync")
    const ok = await attempt(() => wsApi(ws(), "/plaid/sync", { body: itemId ? { item_id: itemId } : {} }), "Synced")
    setBusy(null)
    if (ok) refresh()
  }

  const disconnect = async (item: PlaidItem) => {
    if (!confirm(`Disconnect ${item.institution_name}? Its accounts stop syncing; history stays.`)) return
    setBusy(item.item_id)
    const ok = await attempt(() => wsApi(ws(), `/plaid/items/${encodeURIComponent(item.item_id)}`, { method: "DELETE" }), "Disconnected")
    setBusy(null)
    if (ok) refresh()
  }

  const toggle = async (account: Account, active: boolean) => {
    const ok = await attempt(
      () =>
        wsApi(ws(), `/accounts/${encodeURIComponent(account.id)}/overlay`, {
          body: { is_active: active, reason: active ? "Activated in the web app" : "Deactivated in the web app" },
        }),
      active ? "Account included" : "Account left out of totals",
    )
    if (ok) void refetchAccounts()
  }

  const byItem = createMemo(() => {
    const groups = new Map<string, Array<Account>>()
    for (const account of accounts.latest?.accounts ?? []) {
      const list = groups.get(account.item_id) ?? []
      list.push(account)
      groups.set(account.item_id, list)
    }
    return groups
  })

  return (
    <main class="shell fade-in">
      <section class="section">
        <div class="section-heading">
          <h1 class="page-title">Accounts</h1>
          <Show when={admin()}>
            <div class="actions">
              <Button variant={busy() === "sync" ? "loading" : "neutral"} size="small" icon="refresh" disabled={busy() !== null} onClick={() => void sync()}>
                Sync all
              </Button>
              <Button variant={busy() === "connect" ? "loading" : "contrast"} size="small" icon="plus" disabled={busy() !== null} onClick={() => void connect("new")}>
                Connect bank
              </Button>
            </div>
          </Show>
        </div>
        <p class="page-lede">Inactive accounts keep syncing but are left out of totals, queries and SQL.</p>
      </section>

      <Show when={(items.latest?.items.length ?? 0) === 0 && !items.loading}>
        <div class="card section">
          <h2>No banks connected yet</h2>
          <p>Connect a bank with Plaid, or ask your agent for a connect link.</p>
        </div>
      </Show>

      <For each={items.latest?.items ?? []}>
        {(item) => {
          const healthy = () => item.status === "healthy"
          return (
            <section class="section">
              <div class="section-heading">
                <div class="heading-inline">
                  <Avatar fallback={item.institution_name} size="small" kind="org" />
                  <h2>{item.institution_name}</h2>
                  <span class="section-hint">
                    <span class="status-dot" data-tone={healthy() ? undefined : "warn"} />
                    {healthy() ? `Synced ${formatAgo(item.last_synced_at)}` : (item.error_code ?? item.status)}
                  </span>
                </div>
                <Show when={admin()}>
                  <div class="actions">
                    <Show when={!healthy()}>
                      <Button variant="neutral" size="small" disabled={busy() !== null} onClick={() => void connect("update", item.item_id)}>
                        Reconnect
                      </Button>
                    </Show>
                    <Button
                      variant={busy() === item.item_id ? "loading" : "ghost"}
                      size="small"
                      disabled={busy() !== null}
                      onClick={() => void sync(item.item_id)}
                    >
                      Sync
                    </Button>
                    <Button variant="ghost-danger" size="small" disabled={busy() !== null} onClick={() => void disconnect(item)}>
                      Disconnect
                    </Button>
                  </div>
                </Show>
              </div>
              <div class="table-scroll">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Account</th>
                      <th scope="col" class="hide-narrow">
                        Type
                      </th>
                      <th scope="col" class="num hide-narrow">
                        Available
                      </th>
                      <th scope="col" class="num">
                        Balance
                      </th>
                      <th scope="col" class="end">
                        Included
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={byItem().get(item.item_id) ?? []}>
                      {(account) => (
                        <tr data-dim={account.is_active ? undefined : ""}>
                          <td>
                            <span class="cell-title">
                              <strong>
                                {accountName(account)}
                                <Show when={accountMask(account)}>
                                  {" "}
                                  <span class="mask">••{accountMask(account)}</span>
                                </Show>
                              </strong>
                              <Show when={account.official_name && account.official_name !== account.name}>
                                <span>{account.official_name}</span>
                              </Show>
                            </span>
                          </td>
                          <td class="hide-narrow muted">{account.subtype ?? account.type}</td>
                          <td class="num hide-narrow muted">{formatMoney(account.available_cents, account.currency)}</td>
                          <td class="num">
                            <strong>{formatMoney(account.current_cents, account.currency)}</strong>
                          </td>
                          <td class="end">
                            <Switch
                              checked={account.is_active}
                              disabled={!admin() && props.workspace.role !== "member"}
                              onChange={(value) => void toggle(account, value)}
                              hideLabel
                            >
                              Include {account.name}
                            </Switch>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </section>
          )
        }}
      </For>
    </main>
  )
}
