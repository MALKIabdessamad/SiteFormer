import { useCallback, useMemo } from 'react'
import { fetchServerSentEvents, useChat } from '@tanstack/ai-react'
import { getSupabase } from '~/lib/supabase/client'

const ENDPOINT = '/api/agent'

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await getSupabase().auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * The project's agent chat. Server-authoritative (`persistence: true`): on mount the transcript is
 * hydrated from the server and a run that is still going is re-joined live, so refreshing or
 * coming back later shows the agent's progress where it is.
 */
export function useAgentChat(projectId: string) {
  const connection = useMemo(
    () =>
      fetchServerSentEvents(ENDPOINT, async () => ({
        headers: await authHeaders(),
        cancelUrl: `${ENDPOINT}?action=cancel`,
      })),
    [],
  )
  const chat = useChat({ threadId: projectId, connection, persistence: true })

  /** Stops the agent on the server (works even if this tab isn't attached to the run). */
  const cancel = useCallback(
    async (runId: string | undefined) => {
      chat.stop()
      if (!runId) return
      await fetch(`${ENDPOINT}?action=cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ runId, threadId: projectId }),
      }).catch(() => undefined)
    },
    [chat, projectId],
  )

  return { ...chat, cancel }
}
