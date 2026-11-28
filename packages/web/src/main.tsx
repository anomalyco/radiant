import { ErrorBoundary, Match, Switch } from "solid-js"
import { render } from "solid-js/web"
import { Toast } from "@opencode/ui/toast"
import { boot } from "./state"
import { App } from "./pages/app"
import { Connect } from "./pages/connect"
import { Consent } from "./pages/consent"
import { Device } from "./pages/device"
import { Landing } from "./pages/landing"
import { Notice } from "./pages/notice"
import "./styles.css"

const root = document.getElementById("root")
if (root === null) throw new Error("Missing #root")

function Page() {
  const current = boot
  return (
    <Switch>
      <Match when={current.page === "landing"}>
        <Landing />
      </Match>
      <Match when={current.page === "app" && current}>{(value) => <App boot={value()} />}</Match>
      <Match when={current.page === "connect" && current}>{(value) => <Connect boot={value()} />}</Match>
      <Match when={current.page === "consent" && current}>{(value) => <Consent boot={value()} />}</Match>
      <Match when={current.page === "device" && current}>{(value) => <Device boot={value()} />}</Match>
      <Match when={current.page === "notice" && current}>{(value) => <Notice title={value().title} message={value().message} />}</Match>
    </Switch>
  )
}

render(
  () => (
    <>
      <ErrorBoundary fallback={(error) => <Notice title="Something went wrong" message={error instanceof Error ? error.message : String(error)} />}>
        <Page />
      </ErrorBoundary>
      <Toast.Region />
    </>
  ),
  root,
)
