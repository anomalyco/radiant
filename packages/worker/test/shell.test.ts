import { describe, expect, test } from "bun:test"
import { buildRouteContext, type Env } from "../src/env"
import { isStaticAsset, serveShell } from "../src/shell"

const INDEX = `<!doctype html><html><head><title>Radiant</title></head><body><div id="root"></div></body></html>`

const env = {
  ASSETS: { fetch: async () => new Response(INDEX) } as unknown as Fetcher,
} as unknown as Env

const route = buildRouteContext(new URL("https://anoma.ly/labs/radiant/oauth/callback"), "/labs/radiant")

describe("web app shell", () => {
  test("writes the page's data into index.html where no string can close the element", async () => {
    const message = `</script><script>alert(1)</script>`
    const response = await serveShell(env, route, { page: "notice", title: "Sign-in failed", message }, { status: 400 })
    expect(response.status).toBe(400)
    expect(response.headers.get("content-security-policy")).toContain("script-src 'self' https://cdn.plaid.com")
    const html = await response.text()
    expect(html).not.toContain("<script>alert(1)")
    const json = /<script id="radiant-boot" type="application\/json">(.*?)<\/script>/.exec(html)?.[1]
    expect(JSON.parse(json ?? "null")).toEqual({
      page: "notice",
      title: "Sign-in failed",
      message,
      baseUrl: "https://anoma.ly/labs/radiant",
      basePath: "/labs/radiant",
    })
  })

  test("serves only the build's own files as static assets", () => {
    expect(isStaticAsset("/assets/index-C950Qn8t.js")).toBe(true)
    expect(isStaticAsset("/scheme.js")).toBe(true)
    expect(isStaticAsset("/assets/../index.html")).toBe(false)
    expect(isStaticAsset("/index.html")).toBe(false)
  })
})
