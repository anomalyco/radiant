import { createResource, createSignal, For, Show } from "solid-js"
import { Badge } from "@opencode/ui/badge"
import { Button } from "@opencode/ui/button"
import { wsApi, wsRead } from "../api"
import type { BootWorkspace } from "../boot"
import { formatAgo } from "../format"
import type { Batch } from "../types"
import { attempt } from "../ui/feedback"

type Props = { workspace: BootWorkspace }

const KIND: Record<string, string> = {
  tx_overlay: "Edit",
  tx_split: "Split",
  tx_reset: "Reset",
  tx_manual: "Manual entry",
  account_overlay: "Account",
  rule_create: "New rule",
  rule_update: "Rule change",
  rule_reorder: "Rule order",
  rule_toggle: "Rule toggle",
  rule_delete: "Rule removed",
  pending_carry_forward: "Pending carried",
}

export function Activity(props: Props) {
  const [batches, { refetch }] = createResource(
    () => props.workspace.id,
    (id) => wsRead<{ batches: ReadonlyArray<Batch> }>(id, "/overlays/batches"),
  )
  const [busy, setBusy] = createSignal<string | null>(null)
  const viewer = () => props.workspace.role === "viewer"

  const act = async (batch: Batch, action: "undo" | "redo") => {
    setBusy(batch.id)
    const ok = await attempt(
      () => wsApi(props.workspace.id, `/overlays/batches/${encodeURIComponent(batch.id)}/${action}`, { method: "POST" }),
      action === "undo" ? "Undone" : "Redone",
    )
    setBusy(null)
    if (ok) void refetch()
  }

  return (
    <main class="shell fade-in">
      <div class="section-heading">
        <h1 class="page-title">Activity</h1>
      </div>
      <p class="page-lede" style={{ "margin-bottom": "20px" }}>
        Every edit, rule and account change, by you or an agent. Undo any of them, in any order; the bank's data is never touched.
      </p>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Change</th>
              <th scope="col">Reason</th>
              <th scope="col" class="hide-narrow">
                By
              </th>
              <th scope="col" class="num">
                Rows
              </th>
              <th scope="col" class="num hide-narrow">
                When
              </th>
              <th scope="col" class="end">
                <span class="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <For each={batches.latest?.batches ?? []}>
              {(batch) => (
                <tr data-dim={batch.reverted_at ? "" : undefined}>
                  <td class="nowrap">
                    <span class="heading-inline">
                      <strong>{KIND[batch.kind] ?? batch.kind}</strong>
                      <Show when={batch.reverted_at}>
                        <Badge variant="subtle">undone</Badge>
                      </Show>
                    </span>
                  </td>
                  <td>{batch.reason ?? <span class="faint">—</span>}</td>
                  <td class="hide-narrow muted nowrap">{batch.client_name ?? (batch.actor_type === "user" ? "You" : batch.actor_type)}</td>
                  <td class="num muted">{batch.affected_count}</td>
                  <td class="num hide-narrow muted nowrap">{formatAgo(batch.created_at)}</td>
                  <td class="end">
                    <Show when={!viewer()}>
                      <Button
                        variant={busy() === batch.id ? "loading" : "ghost-muted"}
                        size="small"
                        disabled={busy() !== null}
                        onClick={() => void act(batch, batch.reverted_at ? "redo" : "undo")}
                      >
                        {batch.reverted_at ? "Redo" : "Undo"}
                      </Button>
                    </Show>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        <Show when={!batches.loading && (batches.latest?.batches.length ?? 0) === 0}>
          <p class="table-empty">No changes yet</p>
        </Show>
      </div>
    </main>
  )
}
