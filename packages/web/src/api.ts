import { showToast } from "@opencode/ui/toast"
import { boot } from "./state"

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

/** A JSON call to the Worker's API, under the base path, with the session cookie. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${boot.basePath}/api/v1${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    headers: init.body === undefined ? undefined : { "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const data = (await response.json().catch(() => ({}))) as { message?: string; error?: string }
  if (!response.ok) throw new ApiError(data.message ?? data.error ?? response.statusText, response.status)
  return data as T
}

/** A read for a page's data: a failure shows as a toast and leaves the data empty, rather than taking the page down. */
export const wsRead = <T>(workspaceId: string, path: string, init?: { method?: string; body?: unknown }): Promise<T | undefined> =>
  wsApi<T>(workspaceId, path, init).catch((error: unknown) => {
    showToast({ variant: "error", title: error instanceof Error ? error.message : String(error) })
    return undefined
  })

/** The same call scoped to a workspace. */
export const wsApi = <T>(workspaceId: string, path: string, init?: { method?: string; body?: unknown }) =>
  api<T>(`/workspaces/${encodeURIComponent(workspaceId)}${path}`, init)
