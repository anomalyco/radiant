import { For } from "solid-js"
import { Button } from "@opencode/ui/button"
import { boot } from "../state"
import { copy } from "../ui/feedback"
import { Frame } from "../ui/frame"

const FEATURES = [
  ["Sync", "Bank and card accounts through Plaid, refreshed by webhook and every night."],
  ["Overlays", "Rename, recategorise, tag, split or exclude anything without touching the bank's data."],
  ["Rules", "Declarative rules that apply to history and every new transaction."],
  ["Undo", "Every edit is a batch you can undo or redo, in any order."],
  ["Agents", "An OAuth MCP server for queries, aggregations and read-only SQL."],
] as const

export function Landing() {
  const login = `${boot.basePath}/auth/login`
  const mcp = `${boot.baseUrl}/mcp`
  return (
    <Frame
      end={
        <Button variant="contrast" size="small" onClick={() => (location.href = login)}>
          Sign in
        </Button>
      }
    >
      <main class="shell narrow fade-in">
        <div class="hero">
          <p class="eyebrow">Radiant</p>
          <h1>Your money, in one place your agent can read.</h1>
          <p>Connect your accounts, clean them up with rules and notes, and ask your agent anything about where it goes.</p>
          <div class="actions">
            <Button variant="contrast" onClick={() => (location.href = login)}>
              Sign in with Anomaly
            </Button>
            <Button variant="ghost" onClick={() => (location.href = `${boot.basePath}/index.md`)}>
              Agent docs
            </Button>
          </div>
        </div>
        <ul class="feature-list">
          <For each={FEATURES}>
            {([title, body]) => (
              <li>
                <strong>{title}</strong>
                <span>{body}</span>
              </li>
            )}
          </For>
        </ul>
        <div class="card" style={{ "margin-top": "32px" }}>
          <h2>Use it from your agent</h2>
          <p>Add the MCP server. It signs in with OAuth, so there is no key to paste.</p>
          <div class="secret">
            <code>{mcp}</code>
            <Button variant="ghost" size="small" icon="copy" onClick={() => void copy(mcp, "MCP URL copied")}>
              Copy
            </Button>
          </div>
        </div>
      </main>
    </Frame>
  )
}
