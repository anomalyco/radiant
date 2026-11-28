import { type JSX, Show } from "solid-js"
import { Button } from "@opencode/ui/button"
import { boot } from "../state"

export function BrandMark(props: { loading?: boolean }) {
  return (
    <span class="brand-mark" aria-hidden="true" data-loading={props.loading ? "" : undefined}>
      <i />
      <i />
      <i />
    </span>
  )
}

export function Brand(props: { loading?: boolean }) {
  return (
    <a class="brand" href={`${boot.basePath}/`}>
      <BrandMark loading={props.loading ?? false} />
      Radiant
    </a>
  )
}

/** Signs out through the Worker's form route, which clears the session cookie and redirects home. */
export function SignOut() {
  return (
    <form method="post" action={`${boot.basePath}/auth/logout`}>
      <Button type="submit" variant="ghost-muted" size="small">
        Sign out
      </Button>
    </form>
  )
}

/** The page frame: the header strip on the deep background and one raised panel, like release's admin page. */
export function Frame(props: {
  email?: string
  loading?: boolean
  start?: JSX.Element
  end?: JSX.Element
  nav?: JSX.Element
  children: JSX.Element
}) {
  return (
    <div class="app-frame">
      <header class="app-header">
        <div class="app-header-start">
          <Brand loading={props.loading ?? false} />
          {props.start}
        </div>
        <div class="app-header-end">
          {props.end}
          <Show when={props.email}>
            {(email) => (
              <>
                <span class="header-email">{email()}</span>
                <SignOut />
              </>
            )}
          </Show>
        </div>
      </header>
      <div class="app-panel">
        {props.nav}
        {props.children}
      </div>
    </div>
  )
}
