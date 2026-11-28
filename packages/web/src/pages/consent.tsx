import { For } from "solid-js"
import { Button } from "@opencode/ui/button"
import type { Boot } from "../boot"
import { boot } from "../state"
import { Frame } from "../ui/frame"

type Props = { boot: Extract<Boot, { page: "consent" }> }

export function Consent(props: Props) {
  const redirect = () => {
    try {
      return new URL(props.boot.redirectUri).host || props.boot.redirectUri
    } catch {
      return props.boot.redirectUri
    }
  }
  return (
    <Frame email={props.boot.user.email}>
      <main class="shell narrow fade-in">
        <div class="hero">
          <p class="eyebrow">Authorize</p>
          <h1>{props.boot.clientName} wants access to Radiant</h1>
          <p>
            It will read and edit your workspaces, accounts, transactions, overlays and rules, and run read-only SQL, as{" "}
            <strong>{props.boot.user.email}</strong>.
          </p>
        </div>
        <div class="card" style={{ "margin-top": "28px" }}>
          <dl class="detail-list">
            <dt>Client</dt>
            <dd>{props.boot.clientName}</dd>
            <dt>Returns to</dt>
            <dd>
              <code>{redirect()}</code>
            </dd>
          </dl>
          <form method="post" action={`${boot.basePath}/oauth/authorize`} class="actions">
            <For each={Object.entries(props.boot.fields)}>{([name, value]) => <input type="hidden" name={name} value={value} />}</For>
            <Button type="submit" name="decision" value="approve" variant="contrast">
              Approve
            </Button>
            <Button type="submit" name="decision" value="deny" variant="ghost">
              Deny
            </Button>
          </form>
        </div>
      </main>
    </Frame>
  )
}
