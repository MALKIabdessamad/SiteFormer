import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { getSupabase } from '~/lib/supabase/client'

/** Sends the user to the auth page when the session ends (sign out, other tab, expiry). */
export function useRedirectOnSignOut() {
  const navigate = useNavigate()
  useEffect(() => {
    const { data } = getSupabase().auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') void navigate({ to: '/', replace: true })
    })
    return () => data.subscription.unsubscribe()
  }, [navigate])
}
