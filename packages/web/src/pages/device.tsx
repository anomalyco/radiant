import { Show } from "solid-js"
import { Button } from "@opencode/ui/button"
import { TextInput } from "@opencode/ui/text-input"
import type { Boot } from "../boot"
import { boot } from "../state"
import { Frame } from "../ui/frame"

type Props = { boot: Extract<Boot, { page: "device" }> }

export function Device(props: Props) {
  const agent = () => props.boot.clientName ?? "Your agent"
  return (
    <Frame email={props.boot.user.email}>
      <main class="shell narrow fade-in">
        <Show
          when={props.boot.result}
          fallback={
            <>
              <div class="hero">
                <p class="eyebrow">Agent sign-in</p>
                <h1>{agent()} wants to sign in</h1>
                <p>Check that the code matches the one your agent shows, then approve.</p>
              </div>
              <form method="post" action={`${boot.basePath}/device`} class="card" style={{ "margin-top": "28px" }}>
                <TextInput name="code" value={props.boot.code} placeholder="BCDF-GHJK" required appearance="large" autocomplete="off" />
                <div class="actions">
                  <Button type="submit" name="decision" value="approve" variant="contrast">
                    Approve
                  </Button>
                  <Button type="submit" name="decision" value="deny" variant="ghost">
                    Deny
                  </Button>
                </div>
              </form>
            </>
          }
        >
          {(result) => (
            <div class="hero">
              <p class="eyebrow">Agent sign-in</p>
              <h1>{result() === "approved" ? "Approved" : "Denied"}</h1>
              <p>{result() === "approved" ? "You can go back to your agent." : "The agent was not signed in."}</p>
            </div>
          )}
        </Show>
      </main>
    </Frame>
  )
}
