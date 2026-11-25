import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { getSupabase } from '~/lib/supabase/client'

export type AuthSession =
  | { status: 'loading'; user: null; recovering: false }
  | { status: 'anonymous'; user: null; recovering: false }
  | { status: 'authenticated'; user: User; recovering: boolean }

const LOADING: AuthSession = { status: 'loading', user: null, recovering: false }

/**
 * Tracks the Supabase session in the browser. `recovering` is true after the user
 * arrives through a password-reset link, until they set a new password.
 */
export function useAuthSession() {
  const [session, setSession] = useState<AuthSession>(LOADING)

  useEffect(() => {
    // Fires INITIAL_SESSION right away, then every sign-in, sign-out and token refresh.
    const { data } = getSupabase().auth.onAuthStateChange((event, current) => {
      setSession((prev) => {
        if (!current?.user) return { status: 'anonymous', user: null, recovering: false }
        const recovering =
          event === 'PASSWORD_RECOVERY' || (prev.status === 'authenticated' && prev.recovering)
        return { status: 'authenticated', user: current.user, recovering }
      })
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const finishRecovery = () =>
    setSession((prev) => (prev.status === 'authenticated' ? { ...prev, recovering: false } : prev))

  return { session, finishRecovery }
}
