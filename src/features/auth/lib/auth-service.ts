import { getSupabase } from '~/lib/supabase/client'
import { toErrorMessage } from '~/lib/utils/errors'

/**
 * Thin wrapper around Supabase Auth. Components talk to this module instead of the
 * SDK directly, so every call returns the same shape and never throws.
 */

export type Credentials = { email: string; password: string }

export type AuthResult<T = void> = { ok: true; data: T } | { ok: false; error: string }

/** Where email links (confirmation, password reset) send the user back to. */
function redirectUrl(): string {
  return new URL('/', window.location.origin).toString()
}

async function attempt<T>(fn: () => Promise<T>): Promise<AuthResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) }
  }
}

export const authService = {
  signIn: ({ email, password }: Credentials) =>
    attempt(async () => {
      const { error } = await getSupabase().auth.signInWithPassword({ email, password })
      if (error) throw error
    }),

  /** Resolves `needsConfirmation: true` when Supabase requires the email link first. */
  signUp: ({ email, password }: Credentials) =>
    attempt(async () => {
      const { data, error } = await getSupabase().auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectUrl() },
      })
      if (error) throw error
      return { needsConfirmation: !data.session }
    }),

  sendPasswordReset: (email: string) =>
    attempt(async () => {
      const { error } = await getSupabase().auth.resetPasswordForEmail(email, {
        redirectTo: redirectUrl(),
      })
      if (error) throw error
    }),

  updatePassword: (password: string) =>
    attempt(async () => {
      const { error } = await getSupabase().auth.updateUser({ password })
      if (error) throw error
    }),

  signOut: () =>
    attempt(async () => {
      const { error } = await getSupabase().auth.signOut()
      if (error) throw error
    }),
}
