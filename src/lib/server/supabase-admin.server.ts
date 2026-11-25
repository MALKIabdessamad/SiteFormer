import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from '~/config/env'
import { serverEnv } from './env.server'

/**
 * New-style Supabase keys (sb_publishable_… / sb_secret_…) are opaque, not JWTs: they must be
 * sent in the `apikey` header only, never as `Authorization: Bearer`.
 */
function keyFetch(key: string): typeof fetch {
  const opaque = key.startsWith('sb_publishable_') || key.startsWith('sb_secret_')
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const headers = new Headers(init?.headers)
    if (opaque && headers.get('Authorization') === `Bearer ${key}`) headers.delete('Authorization')
    headers.set('apikey', key)
    return fetch(input, { ...init, headers })
  }) as typeof fetch
}

const serverAuth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }

let adminClient: SupabaseClient | undefined
let verifierClient: SupabaseClient | undefined

/** Secret-key client. Bypasses RLS: the only way projects are written. */
export function supabaseAdmin(): SupabaseClient {
  if (!adminClient) {
    const key = serverEnv().SUPABASE_SECRET_KEY
    adminClient = createClient(env.supabaseUrl, key, {
      global: { fetch: keyFetch(key) },
      auth: serverAuth,
    })
  }
  return adminClient
}

/** Publishable-key client used only to verify users' access tokens. */
export function supabaseVerifier(): SupabaseClient {
  verifierClient ??= createClient(env.supabaseUrl, env.supabasePublishableKey, {
    global: { fetch: keyFetch(env.supabasePublishableKey) },
    auth: serverAuth,
  })
  return verifierClient
}
