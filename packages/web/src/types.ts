// Shapes the JSON API (packages/worker/src/api.ts) returns, as far as the pages read them.

export interface Account {
  readonly id: string
  readonly item_id: string
  readonly institution_name: string
  readonly name: string
  readonly official_name: string | null
  readonly mask: string | null
  readonly type: string
  readonly subtype: string | null
  readonly currency: string
  readonly current_cents: number | null
  readonly available_cents: number | null
  readonly limit_cents: number | null
  readonly nickname: string | null
  readonly is_active: boolean
}

export interface PlaidItem {
  readonly item_id: string
  readonly institution_name: string
  readonly status: string
  readonly error_code: string | null
  readonly error_message: string | null
  readonly last_synced_at: string | null
}

export interface Rule {
  readonly id: string
  readonly name: string
  readonly description: string | null
  readonly priority: number
  readonly enabled: boolean
  readonly match_json: unknown
  readonly actions_json: Readonly<Record<string, unknown>>
  readonly match_count: number
  readonly updated_at: string
}

export interface Batch {
  readonly id: string
  readonly kind: string
  readonly actor_type: string
  readonly client_name: string | null
  readonly reason: string | null
  readonly affected_count: number
  readonly created_at: string
  readonly reverted_at: string | null
}

export interface Member {
  readonly user_id: string
  readonly email: string
  readonly name: string | null
  readonly role: string
}

export interface Invite {
  readonly id: string
  readonly email: string
  readonly role: string
  readonly expires_at: string
  readonly accepted_at: string | null
  readonly revoked_at: string | null
}

export interface ApiToken {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly created_at: string
  readonly last_used_at: string | null
  readonly expires_at: string | null
  readonly revoked_at: string | null
}
