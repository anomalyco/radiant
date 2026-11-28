import { createSignal, For, onMount, Show } from "solid-js"
import { Button } from "@opencode/ui/button"
import { wsApi } from "../api"
import type { Boot } from "../boot"
import { boot } from "../state"
import { Frame } from "../ui/frame"
import { openPlaid } from "../ui/plaid"

type Props = { boot: Extract<Boot, { page: "connect" }> }

interface Linked {
  readonly institution_name: string
  readonly accounts_count: number
  readonly sync?: { readonly added?: number }
}

/** The page an agent's connect link opens: it launches Plaid Link straight away, and can connect more banks after. */
export function Connect(props: Props) {
  const [status, setStatus] = createSignal("Opening Plaid Link…")
  const [busy, setBusy] = createSignal(false)
  const [linked, setLinked] = createSignal<ReadonlyArray<Linked>>([])
  const workspace = () => props.boot.workspace
  const update = () => props.boot.mode === "update" && linked().length === 0

  async function launch() {
    setBusy(true)
    setStatus("Opening Plaid Link…")
    try {
      const { link_token } = await wsApi<{ link_token: string }>(workspace().id, "/plaid/link-token", {
        body: { mode: update() ? "update" : "new", item_id: update() ? props.boot.itemId : null },
      })
      const publicToken = await openPlaid(link_token)
      if (!publicToken) {
        setStatus(linked().length ? "Connect another bank, or go back to your agent." : "Plaid Link closed. Open it again when you're ready.")
        return
      }
      setStatus("Syncing accounts and transactions…")
      const result = await wsApi<Linked>(workspace().id, "/plaid/exchange", {
        body: { public_token: publicToken, connect_token: props.boot.connectToken },
      })
      setLinked([...linked(), result])
      setStatus("Connected. Connect another bank, or go back to your agent.")
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  onMount(() => void launch())

  return (
    <Frame email={props.boot.user.email}>
      <main class="shell narrow fade-in">
        <div class="hero">
          <p class="eyebrow">{workspace().name}</p>
          <h1>{props.boot.mode === "update" ? "Reconnect your bank" : "Connect a bank"}</h1>
          <p>{status()}</p>
          <div class="actions">
            <Button variant={busy() ? "loading" : "contrast"} disabled={busy()} onClick={() => void launch()}>
              {linked().length ? "Connect another bank" : props.boot.mode === "update" ? "Reconnect with Plaid" : "Connect with Plaid"}
            </Button>
            <Button variant="ghost" onClick={() => (location.href = `${boot.basePath}/w/${encodeURIComponent(workspace().slug)}/accounts`)}>
              Open workspace
            </Button>
          </div>
        </div>
        <Show when={linked().length > 0}>
          <ul class="feature-list">
            <For each={linked()}>
              {(item) => (
                <li>
                  <strong>{item.institution_name}</strong>
                  <span>
                    {item.accounts_count} account{item.accounts_count === 1 ? "" : "s"} · {item.sync?.added ?? 0} transactions synced
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </main>
    </Frame>
  )
}
