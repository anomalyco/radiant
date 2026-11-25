import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  acceptInvite,
  createInvite,
  createWorkspace,
  exchangeAuthorizationCode,
  issueAuthorizationCode,
  listMembers,
  pkceS256Challenge,
  refreshOAuthGrant,
  registerOAuthClient,
  removeMember,
  upsertOidcUser,
  verifyBearerToken,
  type Actor,
} from "../src"
import { makeTestLayer } from "./support/test-db"

describe("Workspaces, Invites & MCP OAuth 2.1", () => {
  test("creates workspaces, invites collaborators, enforces owner invariants", async () => {
    const layer = makeTestLayer()
    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const u1 = yield* upsertOidcUser({ issuer: "iss", sub: "1", email: "owner@anoma.ly", name: "Owner" })
          const u2 = yield* upsertOidcUser({ issuer: "iss", sub: "2", email: "guest@anoma.ly", name: "Guest" })
          const owner: Actor = { type: "user", userId: u1.id, email: u1.email, name: u1.name, clientName: "web" }
          const guest: Actor = { type: "user", userId: u2.id, email: u2.email, name: u2.name, clientName: "web" }

          const ws = yield* createWorkspace(owner, { name: "Family Finances" })
          expect(ws.slug).toBe("family-finances")

          // Cannot remove the last owner
          const selfRemove = yield* Effect.result(removeMember(owner, ws.id, owner.userId))
          expect(selfRemove._tag).toBe("Failure")

          // Invite guest and accept
          const inv = yield* createInvite(owner, ws.id, { email: "guest@anoma.ly", role: "member" }, "https://radiant.example")
          expect(inv.invite_url).toContain("/invite/")

          const joined = yield* acceptInvite(guest, inv.invite_token)
          expect(joined.id).toBe(ws.id)
          expect(joined.role).toBe("member")

          const members = yield* listMembers(guest, ws.id)
          expect(members.length).toBe(2)

          // Re-accepting consumed invite fails
          const dup = yield* Effect.result(acceptInvite(guest, inv.invite_token))
          expect(dup._tag).toBe("Failure")
        }),
        layer,
      ),
    )
  })

  test("runs full MCP OAuth 2.1 PKCE flow, refresh rotation, and reuse revocation", async () => {
    const layer = makeTestLayer()
    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const u = yield* upsertOidcUser({ issuer: "iss", sub: "1", email: "dax@anoma.ly", name: "Dax" })

          const client = yield* registerOAuthClient({
            client_name: "OpenCode",
            redirect_uris: ["http://127.0.0.1:4321/callback"],
          })
          const verifier = "super-secret-pkce-verifier-string-0123456789"
          const challenge = yield* pkceS256Challenge(verifier)

          const code = yield* issueAuthorizationCode({
            clientId: client.client_id,
            userId: u.id,
            redirectUri: "http://127.0.0.1:4321/callback",
            codeChallenge: challenge,
            scope: "radiant",
          })

          // Wrong verifier fails
          const badPkce = yield* Effect.result(
            exchangeAuthorizationCode({
              code,
              clientId: client.client_id,
              redirectUri: "http://127.0.0.1:4321/callback",
              codeVerifier: "wrong-verifier",
            }),
          )
          expect(badPkce._tag).toBe("Failure")

          // Valid PKCE succeeds
          const grant1 = yield* exchangeAuthorizationCode({
            code,
            clientId: client.client_id,
            redirectUri: "http://127.0.0.1:4321/callback",
            codeVerifier: verifier,
          })
          const actor = yield* verifyBearerToken(grant1.access_token)
          expect(actor?.userId).toBe(u.id)
          expect(actor?.clientName).toBe("OpenCode")

          // Rotate refresh token
          const grant2 = yield* refreshOAuthGrant({
            refreshToken: grant1.refresh_token,
            clientId: client.client_id,
          })
          expect(grant2.refresh_token).not.toBe(grant1.refresh_token)

          // Reusing old refresh token MUST revoke the entire grant!
          const reuse = yield* Effect.result(
            refreshOAuthGrant({
              refreshToken: grant1.refresh_token,
              clientId: client.client_id,
            }),
          )
          expect(reuse._tag).toBe("Failure")

          const revokedActor = yield* verifyBearerToken(grant2.access_token)
          expect(revokedActor).toBeNull()
        }),
        layer,
      ),
    )
  })
})
