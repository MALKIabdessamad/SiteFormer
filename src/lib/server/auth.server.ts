import { AppError } from './errors.server'
import { supabaseVerifier } from './supabase-admin.server'

export type AuthedUser = { id: string; email: string | null }

/** Verifies `Authorization: Bearer <Supabase access token>` (signature + expiry). */
export async function authenticate(authorization: string | undefined): Promise<AuthedUser> {
  const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? '')?.[1]
  if (!token || token.split('.').length !== 3)
    throw new AppError('Sign in to continue.', 'unauthorized')

  let claims: Record<string, unknown> | undefined
  try {
    const { data, error } = await supabaseVerifier().auth.getClaims(token)
    if (!error) claims = data?.claims as Record<string, unknown> | undefined
  } catch {
    claims = undefined // malformed token: a 401, never a 500
  }
  const sub = claims?.sub
  if (typeof sub !== 'string' || !sub) {
    throw new AppError('Your session expired. Sign in again.', 'unauthorized')
  }
  return { id: sub, email: typeof claims?.email === 'string' ? claims.email : null }
}
