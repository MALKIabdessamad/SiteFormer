/**
 * Browser reads of `projects`. Row Level Security returns only the signed-in user's rows, and
 * Supabase Realtime pushes changes (status, AI-generated name) as they happen.
 */
import { getSupabase } from '~/lib/supabase/client'
import type { Project, ProjectSummary } from '../types'

const SUMMARY_COLUMNS = 'id, name, status, updated_at'
const PROJECT_COLUMNS =
  'id, user_id, name, prompt, status, sandbox_id, preview_url, error, mode, created_at, updated_at'

export async function fetchProjects(): Promise<ProjectSummary[]> {
  const { data, error } = await getSupabase()
    .from('projects')
    .select(SUMMARY_COLUMNS)
    .order('updated_at', { ascending: false })
    .limit(100)
  if (error) throw error
  return (data ?? []) as ProjectSummary[]
}

/** The project, or `null` if it doesn't exist or belongs to someone else. */
export async function fetchProject(id: string): Promise<Project | null> {
  const { data, error } = await getSupabase()
    .from('projects')
    .select(PROJECT_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data as Project | null
}

/**
 * Calls `onChange` whenever a visible project row changes. With `projectId`, only that row.
 * Returns an unsubscribe function.
 */
export function subscribeToProjects(onChange: () => void, projectId?: string): () => void {
  const supabase = getSupabase()
  const channel = supabase
    .channel(`projects:${projectId ?? 'all'}:${crypto.randomUUID()}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'projects',
        ...(projectId ? { filter: `id=eq.${projectId}` } : {}),
      },
      onChange,
    )
    .subscribe()
  return () => void supabase.removeChannel(channel)
}
