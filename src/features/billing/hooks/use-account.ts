import { useCallback, useEffect, useState } from 'react'
import { getSupabase } from '~/lib/supabase/client'
import type { PlanId } from '../lib/credits'

export type Account = {
  plan: PlanId
  planName: string
  credits: number
  maxProjects: number
}

type Row = {
  plan: PlanId
  credits: number
  plans: { name: string; max_projects: number } | null
}

/**
 * The signed-in user's plan and credits (RLS: own row), kept live with Realtime while the AI
 * spends credits, plus a refresh when the tab regains focus. `null` until loaded.
 */
export function useAccount() {
  const [account, setAccount] = useState<Account | null>(null)

  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    void getSupabase()
      .auth.getSession()
      .then(({ data }) => setUserId(data.session?.user.id ?? null))
  }, [])

  // Filtered by the user explicitly (RLS also enforces it).
  const refresh = useCallback(
    () =>
      userId
        ? getSupabase()
            .from('user_plans')
            .select('plan, credits, plans(name, max_projects)')
            .eq('user_id', userId)
            .maybeSingle<Row>()
            .then(({ data, error }) => {
              if (error) return console.error('[billing] account', error.message)
              if (data)
                setAccount({
                  plan: data.plan,
                  planName: data.plans?.name ?? data.plan,
                  credits: data.credits,
                  maxProjects: data.plans?.max_projects ?? 3,
                })
            })
        : Promise.resolve(),
    [userId],
  )

  useEffect(() => {
    if (!userId) return
    void refresh()
    const supabase = getSupabase()
    const channel = supabase
      .channel(`user-plan:${userId}:${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_plans', filter: `user_id=eq.${userId}` },
        () => void refresh(),
      )
      .subscribe()
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      void supabase.removeChannel(channel)
    }
  }, [userId, refresh])

  return { account, refresh, userId }
}
