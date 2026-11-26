import type { ProjectMode } from './lib/constants'

export type ProjectStatus = 'provisioning' | 'ready' | 'failed'

/** A row of `public.projects` as the browser sees it (RLS: own rows only). */
export type Project = {
  id: string
  user_id: string
  name: string
  prompt: string
  status: ProjectStatus
  sandbox_id: string | null
  preview_url: string | null
  error: string | null
  mode: ProjectMode
  created_at: string
  updated_at: string
}

export type ProjectSummary = Pick<Project, 'id' | 'name' | 'status' | 'updated_at'>
