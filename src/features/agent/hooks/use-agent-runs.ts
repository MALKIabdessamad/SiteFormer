import { useCallback, useEffect, useState } from 'react'
import { reportClientError } from '~/lib/report-error'
import { getSupabase } from '~/lib/supabase/client'

export type AgentRun = {
  id: string
  status: 'queued' | 'running' | 'interrupted' | 'completed' | 'failed' | 'aborted'
  prompt: string
  checkpoint_before: string | null
  checkpoint_after: string | null
  files_changed: number | null
  credits_used: number
  /** One-click next steps under the reply (arrive a few seconds after it finishes). */
  suggestions: Array<string> | null
  created_at: string
  finished_at: string | null
}

const COLUMNS =
  'id, status, prompt, checkpoint_before, checkpoint_after, files_changed, credits_used, suggestions, created_at, finished_at'

/** Polling interval while a run is active (Realtime usually updates sooner). */
const ACTIVE_POLL_MS = 4000

const isActiveRun = (run: AgentRun | undefined) =>
  run?.status === 'queued' || run?.status === 'running'

/**
 * A run is settled once it ended AND its after-run checkpoint is written (that happens a few
 * seconds after the status turns terminal). If checkpointing failed, it counts as settled 30 s
 * after finishing, so the UI never waits forever.
 */
export const isSettledRun = (run: AgentRun | undefined) =>
  Boolean(run) &&
  !isActiveRun(run) &&
  (Boolean(run!.checkpoint_after) ||
    !run!.checkpoint_before ||
    (run!.finished_at !== null && Date.now() - Date.parse(run!.finished_at) > 30_000))

/** The project's agent runs (oldest first), kept live with Realtime (RLS: own runs only). */
export function useAgentRuns(projectId: string) {
  const [runs, setRuns] = useState<Array<AgentRun>>([])

  const refresh = useCallback(
    () =>
      getSupabase()
        .from('agent_runs')
        .select(COLUMNS)
        .eq('project_id', projectId)
        .order('created_at', { ascending: true })
        .limit(500)
        .then(({ data, error }) => {
          if (error)
            reportClientError('agent-runs', 'Could not load runs', {
              projectId,
              detail: error.message,
            })
          else setRuns((data ?? []) as Array<AgentRun>)
        }),
    [projectId],
  )

  useEffect(() => {
    void refresh()
    const supabase = getSupabase()
    const channel = supabase
      .channel(`agent-runs:${projectId}:${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agent_runs', filter: `project_id=eq.${projectId}` },
        () => void refresh(),
      )
      .subscribe()
    return () => void supabase.removeChannel(channel)
  }, [projectId, refresh])

  // Poll until every run is settled, in case Realtime is unavailable (status and checkpoints
  // still update).
  const activeRun = runs.find(isActiveRun)
  const unsettled = runs.some((run) => !isSettledRun(run))
  // Next-step suggestions arrive a few seconds after a reply ends: keep looking for a moment.
  const last = runs.at(-1)
  const awaitingSince = last?.status === 'completed' && !last.suggestions ? last.finished_at : null
  useEffect(() => {
    const wait = awaitingSince ? Date.parse(awaitingSince) + 40_000 - Date.now() : 0
    if (!unsettled && wait <= 0) return
    const timer = setInterval(() => void refresh(), ACTIVE_POLL_MS)
    const stop = unsettled ? undefined : setTimeout(() => clearInterval(timer), wait)
    return () => {
      clearInterval(timer)
      clearTimeout(stop)
    }
  }, [unsettled, awaitingSince, refresh])

  return { runs, activeRun, refresh }
}
