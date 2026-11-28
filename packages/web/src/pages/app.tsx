import { createEffect, createSignal, For, Match, onMount, Show, Switch } from "solid-js"
import { Button } from "@opencode/ui/button"
import { Select } from "@opencode/ui/select"
import { TextInput } from "@opencode/ui/text-input"
import { api } from "../api"
import type { Boot, BootWorkspace } from "../boot"
import { follow, hrefFor, navigate, route, TABS, type Tab } from "../route"
import { attempt, toastSuccess } from "../ui/feedback"
import { Frame } from "../ui/frame"
import { Accounts } from "./accounts"
import { Activity } from "./activity"
import { Rules } from "./rules"
import { Settings } from "./settings"

type Props = { boot: Extract<Boot, { page: "app" }> }

const LABELS: Record<Tab, string> = {
  accounts: "Accounts",
  rules: "Rules",
  activity: "Activity",
  settings: "Settings",
}

export function App(props: Props) {
  const [workspaces, setWorkspaces] = createSignal<ReadonlyArray<BootWorkspace>>(props.boot.workspaces)

  const refreshWorkspaces = async () => {
    const me = await api<{ workspaces: ReadonlyArray<BootWorkspace> }>("/me")
    setWorkspaces(me.workspaces)
    return me.workspaces
  }

  onMount(() => {
    if (props.boot.flash) toastSuccess(props.boot.flash)
  })

  // Home with a workspace goes to the first one; the Worker does the same on a full load.
  createEffect(() => {
    const current = route()
    const first = workspaces()[0]
    if (current.kind === "home" && first) navigate({ kind: "workspace", slug: first.slug, tab: "accounts" }, { replace: true })
  })

  const workspace = () => {
    const current = route()
    return current.kind === "workspace" ? workspaces().find((candidate) => candidate.slug === current.slug || candidate.id === current.slug) : undefined
  }
  const tab = () => {
    const current = route()
    return current.kind === "workspace" ? current.tab : "accounts"
  }

  return (
    <Frame
      email={props.boot.user.email}
      start={
        <Show when={workspace()}>
          {(current) => (
            <>
              <span class="header-slash">/</span>
              <Select
                options={[...workspaces()]}
                current={current()}
                value={(item) => item.id}
                label={(item) => item.name}
                appearance="small"
                surface="invisible"
                class="workspace-select"
                onSelect={(item) => item && navigate({ kind: "workspace", slug: item.slug, tab: tab() })}
              />
            </>
          )}
        </Show>
      }
      nav={
        <Show when={workspace()}>
          {(current) => (
            <nav class="nav-tabs" aria-label="Workspace">
              <For each={TABS}>
                {(name) => {
                  const target = () => ({ kind: "workspace" as const, slug: current().slug, tab: name })
                  return (
                    <a href={hrefFor(target())} onClick={follow(target())} aria-current={tab() === name ? "page" : undefined}>
                      {LABELS[name]}
                    </a>
                  )
                }}
              </For>
            </nav>
          )}
        </Show>
      }
    >
      <Switch>
        <Match when={workspaces().length === 0}>
          <CreateWorkspace
            onCreated={async (slug) => {
              await refreshWorkspaces()
              navigate({ kind: "workspace", slug, tab: "accounts" })
            }}
          />
        </Match>
        <Match when={route().kind === "workspace" && !workspace()}>
          <main class="shell narrow">
            <div class="hero">
              <p class="eyebrow">Not found</p>
              <h1>No workspace here</h1>
              <p>It doesn't exist, or you aren't a member.</p>
            </div>
          </main>
        </Match>
        <Match when={workspace()}>
          {(current) => (
            <Switch>
              <Match when={tab() === "accounts"}>
                <Accounts workspace={current()} />
              </Match>
              <Match when={tab() === "rules"}>
                <Rules workspace={current()} />
              </Match>
              <Match when={tab() === "activity"}>
                <Activity workspace={current()} />
              </Match>
              <Match when={tab() === "settings"}>
                <Settings workspace={current()} onWorkspacesChanged={refreshWorkspaces} />
              </Match>
            </Switch>
          )}
        </Match>
      </Switch>
    </Frame>
  )
}

export function CreateWorkspace(props: { onCreated: (slug: string) => void | Promise<void>; compact?: boolean }) {
  const [name, setName] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    setBusy(true)
    let slug: string | undefined
    const ok = await attempt(async () => {
      const created = await api<{ slug: string }>("/workspaces", { body: { name: name().trim() || "Personal", currency: "USD" } })
      slug = created.slug
    })
    setBusy(false)
    if (ok && slug) await props.onCreated(slug)
  }
  const form = (
    <form class="form-row" onSubmit={submit}>
      <div class="grow">
        <TextInput placeholder="Personal" value={name()} onInput={(event) => setName(event.currentTarget.value)} maxLength={120} aria-label="Workspace name" />
      </div>
      <Button type="submit" variant={busy() ? "loading" : "contrast"} disabled={busy()}>
        Create workspace
      </Button>
    </form>
  )
  return (
    <Show when={!props.compact} fallback={form}>
      <main class="shell narrow fade-in">
        <div class="hero">
          <p class="eyebrow">Get started</p>
          <h1>Create your first workspace</h1>
          <p>A workspace holds your connected accounts, rules, notes and the people you share them with.</p>
        </div>
        <div class="card" style={{ "margin-top": "28px" }}>
          {form}
        </div>
      </main>
    </Show>
  )
}
