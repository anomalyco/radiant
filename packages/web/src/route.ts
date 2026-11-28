import { createSignal } from "solid-js"
import { boot } from "./state"

// Transactions themselves are read and edited over MCP; the app covers setup: accounts, rules, history and access.
export const TABS = ["accounts", "rules", "activity", "settings"] as const
export type Tab = (typeof TABS)[number]

export type Route = { readonly kind: "home" } | { readonly kind: "workspace"; readonly slug: string; readonly tab: Tab }

function parse(pathname: string): Route {
  const path = pathname.startsWith(boot.basePath) ? pathname.slice(boot.basePath.length) : pathname
  const parts = path.split("/").filter(Boolean)
  if (parts[0] === "w" && parts[1]) {
    const tab = TABS.find((candidate) => candidate === parts[2]) ?? "accounts"
    return { kind: "workspace", slug: decodeURIComponent(parts[1]), tab }
  }
  return { kind: "home" }
}

const [route, setRoute] = createSignal(parse(location.pathname))
export { route }

export const hrefFor = (next: Route) =>
  next.kind === "home"
    ? `${boot.basePath}/`
    : `${boot.basePath}/w/${encodeURIComponent(next.slug)}${next.tab === "accounts" ? "" : `/${next.tab}`}`

export function navigate(next: Route, options: { replace?: boolean } = {}) {
  const href = hrefFor(next)
  if (options.replace) history.replaceState(null, "", href)
  else history.pushState(null, "", href)
  setRoute(next)
  window.scrollTo({ top: 0 })
}

/** An anchor's click handler that routes in place, keeping modified clicks for new tabs. */
export const follow = (next: Route) => (event: MouseEvent) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  navigate(next)
}

window.addEventListener("popstate", () => setRoute(parse(location.pathname)))
