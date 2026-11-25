import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from '~/config/env'

let client: SupabaseClient | undefined

/**
 * Browser Supabase client (singleton).
 *
 * Sessions are persisted in localStorage, so this must only be called in the browser:
 * from effects, event handlers or client-only loaders. Calling it during SSR throws,
 * which surfaces mistakes early instead of silently creating a sessionless client.
 */
export function getSupabase(): SupabaseClient {
  if (typeof window === 'undefined') {
    throw new Error('getSupabase() is browser-only. Call it from an effect or event handler.')
  }
  client ??= createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Implicit flow: confirmation and reset links work even when opened on another
      // device or browser (PKCE needs the verifier stored in the original browser).
      detectSessionInUrl: true,
    },
  })
  return client
}
