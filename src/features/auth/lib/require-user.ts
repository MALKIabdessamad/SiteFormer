import { redirect } from '@tanstack/react-router'
import type { User } from '@supabase/supabase-js'
import { getSupabase } from '~/lib/supabase/client'

/**
 * Route guard for client-only routes: returns the signed-in user or redirects to `/`.
 * `getSession` reads the local session (refreshing it if needed) without a network
 * round trip on every navigation; data access is still enforced by Row Level Security.
 */
export async function requireUser(): Promise<User> {
  const { data } = await getSupabase().auth.getSession()
  if (!data.session) throw redirect({ to: '/', replace: true })
  return data.session.user
}
