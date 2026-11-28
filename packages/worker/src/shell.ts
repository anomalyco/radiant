import { BOOT_ELEMENT_ID, type Boot } from "@radiant/web/boot"
import { escapeHtml, type Env, type RouteContext } from "./env"

/** Boot data without the base fields every page shares; serveShell adds them. */
export type PageBoot = Boot extends infer B ? (B extends Boot ? Omit<B, "baseUrl" | "basePath"> : never) : never

// The built page's static files (packages/web/dist): served as they are under the base path.
const STATIC = /^\/(assets\/[\w.-]+|scheme\.js|favicon\.svg)$/

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdn.plaid.com",
  // Solid writes style attributes for chart heights and widths.
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self' https://*.plaid.com",
  "frame-src https://cdn.plaid.com https://*.plaid.com",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ")

// Used when the Worker runs without its ASSETS binding, as in tests.
const FALLBACK = `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><title>Radiant</title></head><body><div id="root"></div></body></html>`

export const isStaticAsset = (path: string): boolean => STATIC.test(path)

/** A file of the built page, from the ASSETS binding, cached for good when its name is content-hashed. */
export const serveStatic = async (env: Env, route: RouteContext): Promise<Response> => {
  if (!env.ASSETS) return new Response("Not found", { status: 404 })
  const response = await env.ASSETS.fetch(new Request(new URL(route.path, route.origin)))
  if (!response.ok) return response
  const headers = new Headers(response.headers)
  headers.set("cache-control", route.path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=300")
  headers.set("x-content-type-options", "nosniff")
  return new Response(response.body, { status: response.status, headers })
}

/** The page shell, index.html, with what the page needs to render written in as JSON. */
export const serveShell = async (
  env: Env,
  route: RouteContext,
  page: PageBoot,
  options: { readonly status?: number; readonly headers?: Record<string, string> } = {},
): Promise<Response> => {
  const shell = env.ASSETS ? await (await env.ASSETS.fetch(new Request(new URL("/index.html", route.origin)))).text() : FALLBACK
  const boot = { ...page, baseUrl: route.baseUrl, basePath: route.basePath } as Boot
  // `<` escaped so no string in the data can close the element.
  const json = JSON.stringify(boot).replace(/</g, "\\u003c")
  const head = [
    `<script id="${BOOT_ELEMENT_ID}" type="application/json">${json}</script>`,
    boot.page === "landing" ? `<link rel="alternate" type="text/markdown" href="${escapeHtml(route.baseUrl)}/index.md" />` : "",
  ].join("")
  return new Response(shell.replace("</head>", `${head}</head>`), {
    status: options.status ?? 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
      "referrer-policy": "same-origin",
      "content-security-policy": CSP,
      ...options.headers,
    },
  })
}
