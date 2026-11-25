import { useCallback, useEffect, useState } from 'react'
import { fetchProject, fetchProjects, subscribeToProjects } from '../api/projects.queries'
import type { Project, ProjectSummary } from '../types'

/** The signed-in user's projects, kept live. */
export function useProjects() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(
    () =>
      fetchProjects()
        .then(setProjects)
        .catch((error: unknown) => console.error('[projects] could not load', error))
        .finally(() => setLoading(false)),
    [],
  )

  useEffect(() => {
    void refresh()
    return subscribeToProjects(() => void refresh())
  }, [refresh])

  return { projects, loading }
}

type ProjectState =
  | { status: 'loading'; project: null }
  | { status: 'missing'; project: null }
  | { status: 'error'; project: null }
  | { status: 'loaded'; project: Project }

/** Polling interval while the sandbox is being set up, in case Realtime is unavailable. */
const SETUP_POLL_MS = 4000

/** One project, kept live (Realtime, plus polling while its sandbox is set up). */
export function useProject(projectId: string) {
  const [state, setState] = useState<ProjectState>({ status: 'loading', project: null })

  const refresh = useCallback(
    () =>
      fetchProject(projectId)
        .then((project) =>
          setState(project ? { status: 'loaded', project } : { status: 'missing', project: null }),
        )
        .catch((error: unknown) => {
          console.error('[project] could not load', error)
          // Keep showing the last good state on a transient error.
          setState((prev) => (prev.status === 'loaded' ? prev : { status: 'error', project: null }))
        }),
    [projectId],
  )

  useEffect(() => {
    void refresh()
    return subscribeToProjects(() => void refresh(), projectId)
  }, [projectId, refresh])

  const settingUp = state.project?.status === 'provisioning'
  useEffect(() => {
    if (!settingUp) return
    const timer = setInterval(() => void refresh(), SETUP_POLL_MS)
    return () => clearInterval(timer)
  }, [settingUp, refresh])

  return { ...state, refresh }
}
