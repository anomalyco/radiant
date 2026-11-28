// What the Worker tells the page it serves (packages/worker/src/shell.ts). The Worker writes it into index.html as
// a JSON script element, so a page renders without a round trip and no inline script runs.

export interface BootUser {
  readonly email: string
  readonly name: string | null
}

export interface BootWorkspace {
  readonly id: string
  readonly slug: string
  readonly name: string
  readonly currency: string
  readonly role: "owner" | "admin" | "member" | "viewer"
}

interface BootBase {
  /** Origin plus base path, without a trailing slash, e.g. https://anoma.ly/labs/radiant */
  readonly baseUrl: string
  /** Base path without a trailing slash, e.g. /labs/radiant */
  readonly basePath: string
}

export type Boot = BootBase &
  (
    | { readonly page: "landing" }
    | { readonly page: "app"; readonly user: BootUser; readonly workspaces: ReadonlyArray<BootWorkspace>; readonly flash: string | null }
    | {
        readonly page: "connect"
        readonly user: BootUser
        readonly workspace: BootWorkspace
        readonly connectToken: string
        readonly mode: "new" | "update"
        readonly itemId: string | null
      }
    | {
        readonly page: "consent"
        readonly user: BootUser
        readonly clientName: string
        readonly redirectUri: string
        readonly fields: Readonly<Record<string, string>>
      }
    | {
        readonly page: "device"
        readonly user: BootUser
        readonly code: string
        readonly clientName: string | null
        readonly result: "approved" | "denied" | null
      }
    | { readonly page: "notice"; readonly title: string; readonly message: string }
  )

export const BOOT_ELEMENT_ID = "radiant-boot"
