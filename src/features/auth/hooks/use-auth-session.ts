import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { getSupabase } from '~/lib/supabase/client'

export type AuthSession =
  | { status: 'loading'; user: null }
  | { status: 'anonymous'; user: null }
  | { status: 'authenticated'; user: User }

/** Tracks the Supabase session in the browser. */
export function useAuthSession(): AuthSession {
  const [session, setSession] = useState<AuthSession>({ status: 'loading', user: null })

  useEffect(() => {
    // Fires INITIAL_SESSION right away, then on every sign-in, sign-out and token refresh.
    const { data } = getSupabase().auth.onAuthStateChange((_event, current) => {
      setSession(
        current?.user
          ? { status: 'authenticated', user: current.user }
          : { status: 'anonymous', user: null },
      )
    })
    return () => data.subscription.unsubscribe()
  }, [])

  return session
}
