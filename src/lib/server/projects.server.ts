/**
 * Server-side project helpers shared by the server functions and the agent runner.
 */
import { AppError } from './app-error'
import type { ProvisionTarget, SandboxPatch } from './sandbox/provision.server'
import { supabaseAdmin } from './supabase-admin.server'

export type ProjectRow = {
  id: string
  user_id: string
  name: string
  status: 'provisioning' | 'ready' | 'failed'
  sandbox_id: string | null
  preview_url: string | null
  error: string | null
}

const COLUMNS = 'id, user_id, name, status, sandbox_id, preview_url, error'

/** The project, or null if it doesn't exist. */
export async function getProject(projectId: string): Promise<ProjectRow | null> {
  const { data, error } = await supabaseAdmin()
    .from('projects')
    .select(COLUMNS)
    .eq('id', projectId)
    .maybeSingle<ProjectRow>()
  if (error) throw error
  return data
}

/** The project if `userId` owns it; otherwise a 404-style AppError (never reveals existence). */
export async function ownedProject(userId: string, projectId: string): Promise<ProjectRow> {
  const project = await getProject(projectId)
  if (!project || project.user_id !== userId) throw new AppError('Project not found.', 'not_found')
  return project
}

export async function saveProject(projectId: string, patch: SandboxPatch | { name: string }) {
  const { error } = await supabaseAdmin().from('projects').update(patch).eq('id', projectId)
  if (error) throw new Error(`Could not save project ${projectId}: ${error.message}`)
}

/** Provisioning target for a project (persists progress on the project row). */
export function provisionTarget(
  project: Pick<ProjectRow, 'id' | 'user_id' | 'sandbox_id'>,
): ProvisionTarget {
  return {
    projectId: project.id,
    userId: project.user_id,
    sandboxId: project.sandbox_id,
    save: (patch) => saveProject(project.id, patch),
  }
}
