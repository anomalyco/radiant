import { createResource, createSignal, For, Show } from "solid-js"
import { Avatar } from "@opencode/ui/avatar"
import { Badge } from "@opencode/ui/badge"
import { Button } from "@opencode/ui/button"
import { Select } from "@opencode/ui/select"
import { TextInput } from "@opencode/ui/text-input"
import { wsApi, wsRead } from "../api"
import type { BootWorkspace } from "../boot"
import { formatAgo, formatDayYear } from "../format"
import { navigate } from "../route"
import { boot } from "../state"
import type { ApiToken, Invite, Member } from "../types"
import { attempt, copy } from "../ui/feedback"
import { CreateWorkspace } from "./app"

type Props = { workspace: BootWorkspace; onWorkspacesChanged: () => Promise<ReadonlyArray<BootWorkspace>> }

const ROLES = ["viewer", "member", "admin"] as const
type Role = (typeof ROLES)[number]

export function Settings(props: Props) {
  const admin = () => props.workspace.role === "owner" || props.workspace.role === "admin"
  return (
    <main class="shell fade-in">
      <div class="section-heading">
        <h1 class="page-title">Settings</h1>
      </div>
      <Connect />
      <Members workspace={props.workspace} admin={admin()} />
      <Show when={admin()}>
        <Tokens workspace={props.workspace} />
        <Rename workspace={props.workspace} onChanged={props.onWorkspacesChanged} />
      </Show>
      <section class="section">
        <div class="section-heading">
          <h2>New workspace</h2>
        </div>
        <div class="card">
          <p>Keep a household, a business or someone else's money apart, with its own members.</p>
          <CreateWorkspace
            compact
            onCreated={async (slug) => {
              await props.onWorkspacesChanged()
              navigate({ kind: "workspace", slug, tab: "accounts" })
            }}
          />
        </div>
      </section>
    </main>
  )
}

function Connect() {
  const url = `${boot.baseUrl}/mcp`
  const config = JSON.stringify({ mcp: { servers: { radiant: { type: "remote", url } } } }, null, 2)
  return (
    <section class="section">
      <div class="section-heading">
        <h2>Connect an agent</h2>
      </div>
      <div class="card">
        <p>Add Radiant as a remote MCP server. It signs in with OAuth on first use.</p>
        <div class="secret">
          <code>{url}</code>
          <Button variant="ghost" size="small" icon="copy" onClick={() => void copy(url, "MCP URL copied")}>
            Copy
          </Button>
        </div>
        <pre class="code-block">{config}</pre>
        <div class="actions">
          <Button variant="neutral" size="small" icon="copy" onClick={() => void copy(config, "opencode.json copied")}>
            Copy opencode.json
          </Button>
        </div>
      </div>
    </section>
  )
}

function Members(props: { workspace: BootWorkspace; admin: boolean }) {
  const ws = () => props.workspace.id
  const [members, { refetch: refetchMembers }] = createResource(ws, (id) => wsRead<{ members: ReadonlyArray<Member> }>(id, "/members"))
  const [invites, { refetch: refetchInvites }] = createResource(
    () => (props.admin ? ws() : undefined),
    (id) => wsRead<{ invites: ReadonlyArray<Invite> }>(id, "/invites"),
  )
  const [email, setEmail] = createSignal("")
  const [role, setRole] = createSignal<Role>("member")
  const [link, setLink] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)

  const pending = () => (invites.latest?.invites ?? []).filter((invite) => !invite.accepted_at && !invite.revoked_at && Date.parse(invite.expires_at.replace(" ", "T") + "Z") > Date.now())

  const invite = async (event: SubmitEvent) => {
    event.preventDefault()
    setBusy(true)
    await attempt(async () => {
      const created = await wsApi<{ invite_url: string }>(ws(), "/invites", { body: { email: email().trim(), role: role() } })
      setLink(created.invite_url)
      setEmail("")
      void copy(created.invite_url, "Invite link copied")
      void refetchInvites()
    })
    setBusy(false)
  }

  const revoke = async (item: Invite) => {
    const ok = await attempt(() => wsApi(ws(), `/invites/${encodeURIComponent(item.id)}`, { method: "DELETE" }), "Invite revoked")
    if (ok) void refetchInvites()
  }

  const remove = async (member: Member) => {
    if (!confirm(`Remove ${member.email} from ${props.workspace.name}?`)) return
    const ok = await attempt(() => wsApi(ws(), `/members/${encodeURIComponent(member.user_id)}`, { method: "DELETE" }), "Member removed")
    if (ok) void refetchMembers()
  }

  return (
    <section class="section">
      <div class="section-heading">
        <div class="heading-inline">
          <h2>Members</h2>
          <Badge>{members.latest?.members.length ?? 0}</Badge>
        </div>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <tbody>
            <For each={members.latest?.members ?? []}>
              {(member) => (
                <tr>
                  <td>
                    <span class="cell-with-avatar">
                      <Avatar fallback={member.name ?? member.email} size="small" />
                      <span class="cell-title">
                        <strong>{member.name ?? member.email}</strong>
                        <Show when={member.name}>
                          <span>{member.email}</span>
                        </Show>
                      </span>
                    </span>
                  </td>
                  <td class="end">
                    <Badge variant={member.role === "owner" ? "accent" : "neutral"}>{member.role}</Badge>
                  </td>
                  <td class="end" style={{ width: "1%" }}>
                    <Show when={props.admin && member.role !== "owner"}>
                      <Button variant="ghost-danger" size="small" onClick={() => void remove(member)}>
                        Remove
                      </Button>
                    </Show>
                  </td>
                </tr>
              )}
            </For>
            <For each={pending()}>
              {(item) => (
                <tr data-dim="">
                  <td>
                    <span class="cell-with-avatar">
                      <Avatar fallback={item.email} size="small" />
                      <span class="cell-title">
                        <strong>{item.email}</strong>
                        <span>Invited · expires {formatDayYear(item.expires_at)}</span>
                      </span>
                    </span>
                  </td>
                  <td class="end">
                    <Badge variant="subtle">{item.role}</Badge>
                  </td>
                  <td class="end">
                    <Button variant="ghost-muted" size="small" onClick={() => void revoke(item)}>
                      Revoke
                    </Button>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
      <Show when={props.admin}>
        <form class="form-row" style={{ "margin-top": "12px" }} onSubmit={invite}>
          <div class="grow">
            <TextInput type="email" required placeholder="name@example.com" value={email()} onInput={(event) => setEmail(event.currentTarget.value)} aria-label="Email to invite" />
          </div>
          <Select options={[...ROLES]} current={role()} label={(item) => item} onSelect={(item) => item && setRole(item)} appearance="base" class="role-select" />
          <Button type="submit" variant={busy() ? "loading" : "neutral"} disabled={busy()}>
            Create invite link
          </Button>
        </form>
        <Show when={link()}>
          {(url) => (
            <div class="secret" style={{ "margin-top": "12px" }}>
              <code>{url()}</code>
              <Button variant="ghost" size="small" icon="copy" onClick={() => void copy(url(), "Invite link copied")}>
                Copy
              </Button>
            </div>
          )}
        </Show>
      </Show>
    </section>
  )
}

function Tokens(props: { workspace: BootWorkspace }) {
  const ws = () => props.workspace.id
  const [tokens, { refetch }] = createResource(ws, (id) => wsRead<{ tokens: ReadonlyArray<ApiToken> }>(id, "/tokens"))
  const [name, setName] = createSignal("")
  const [secret, setSecret] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)
  const live = () => (tokens.latest?.tokens ?? []).filter((token) => !token.revoked_at)

  const create = async (event: SubmitEvent) => {
    event.preventDefault()
    setBusy(true)
    await attempt(async () => {
      const created = await wsApi<{ token: string }>(ws(), "/tokens", { body: { name: name().trim() || "script", role: "member" } })
      setSecret(created.token)
      setName("")
      void refetch()
    })
    setBusy(false)
  }

  const revoke = async (token: ApiToken) => {
    if (!confirm(`Revoke "${token.name}"? Anything using it stops working.`)) return
    const ok = await attempt(() => wsApi(ws(), `/tokens/${encodeURIComponent(token.id)}`, { method: "DELETE" }), "Token revoked")
    if (ok) void refetch()
  }

  return (
    <section class="section">
      <div class="section-heading">
        <h2>API tokens</h2>
        <span class="section-hint">For scripts; agents should use MCP sign-in</span>
      </div>
      <Show when={live().length > 0}>
        <div class="table-scroll" style={{ "margin-bottom": "12px" }}>
          <table class="data-table">
            <tbody>
              <For each={live()}>
                {(token) => (
                  <tr>
                    <td>
                      <span class="cell-title">
                        <strong>{token.name}</strong>
                        <span>Last used {formatAgo(token.last_used_at).toLowerCase()}</span>
                      </span>
                    </td>
                    <td class="end">
                      <Badge variant="subtle">{token.role}</Badge>
                    </td>
                    <td class="end" style={{ width: "1%" }}>
                      <Button variant="ghost-danger" size="small" onClick={() => void revoke(token)}>
                        Revoke
                      </Button>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
      <form class="form-row" onSubmit={create}>
        <div class="grow">
          <TextInput placeholder="Token name, e.g. backup-script" value={name()} onInput={(event) => setName(event.currentTarget.value)} aria-label="Token name" />
        </div>
        <Button type="submit" variant={busy() ? "loading" : "neutral"} disabled={busy()}>
          Create token
        </Button>
      </form>
      <Show when={secret()}>
        {(value) => (
          <div class="stack" style={{ "margin-top": "12px" }}>
            <div class="secret">
              <code>{value()}</code>
              <Button variant="ghost" size="small" icon="copy" onClick={() => void copy(value(), "Token copied")}>
                Copy
              </Button>
            </div>
            <span class="section-hint warning">Shown once. Store it now.</span>
          </div>
        )}
      </Show>
    </section>
  )
}

function Rename(props: { workspace: BootWorkspace; onChanged: () => Promise<ReadonlyArray<BootWorkspace>> }) {
  const [name, setName] = createSignal(props.workspace.name)
  const [busy, setBusy] = createSignal(false)
  const save = async (event: SubmitEvent) => {
    event.preventDefault()
    setBusy(true)
    const ok = await attempt(() => wsApi(props.workspace.id, "", { method: "PATCH", body: { name: name().trim() } }), "Workspace renamed")
    setBusy(false)
    if (ok) await props.onChanged()
  }
  return (
    <section class="section">
      <div class="section-heading">
        <h2>Workspace</h2>
      </div>
      <form class="form-row" onSubmit={save}>
        <div class="grow">
          <TextInput value={name()} onInput={(event) => setName(event.currentTarget.value)} maxLength={120} required aria-label="Workspace name" />
        </div>
        <Button type="submit" variant={busy() ? "loading" : "neutral"} disabled={busy() || name().trim() === props.workspace.name}>
          Rename
        </Button>
      </form>
    </section>
  )
}
