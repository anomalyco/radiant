import { Button } from "@opencode/ui/button"
import { boot } from "../state"
import { Frame } from "../ui/frame"

export function Notice(props: { title: string; message: string }) {
  return (
    <Frame>
      <main class="shell narrow">
        <div class="hero fade-in">
          <p class="eyebrow">Radiant</p>
          <h1>{props.title}</h1>
          <p>{props.message}</p>
          <div class="actions">
            <Button variant="neutral" onClick={() => (location.href = `${boot.basePath}/`)}>
              Go home
            </Button>
          </div>
        </div>
      </main>
    </Frame>
  )
}
