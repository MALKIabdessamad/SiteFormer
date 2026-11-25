/**
 * Server functions for the project lifecycle. They run on the server as the verified user and are
 * the only code that writes `projects` (with the secret key). Reads happen in the browser under
 * Row Level Security (see projects.queries.ts).
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { generateProjectName } from '~/lib/server/ai/naming.server'
import { requireUser } from '~/lib/server/require-user'
import { serverEnv } from '~/lib/server/env.server'
import { AppError, safely } from '~/lib/server/errors.server'
import { deleteInstance } from '~/lib/server/sandbox/agent37.server'
import {
  ensureProvisioned,
  ensureRunning,
  isBusy,
  type ProvisionTarget,
  type SandboxPatch,
} from '~/lib/server/sandbox/provision.server'
import { supabaseAdmin } from '~/lib/server/supabase-admin.server'
import { PROMPT_MAX_LENGTH } from '../lib/constants'
import { nameFromPrompt } from '../lib/project-name'
import type { Project } from '../types'

const ProjectIdInput = z.object({ projectId: z.uuid() })

type OwnedProject = Pick<Project, 'id' | 'user_id' | 'status' | 'sandbox_id'>

async function ownedProject(userId: string, projectId: string): Promise<OwnedProject> {
  const { data, error } = await supabaseAdmin()
    .from('projects')
    .select('id, user_id, status, sandbox_id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle<OwnedProject>()
  if (error) throw error
  if (!data) throw new AppError('Project not found.', 'not_found')
  return data
}

async function saveProject(projectId: string, patch: SandboxPatch | { name: string }) {
  const { error } = await supabaseAdmin().from('projects').update(patch).eq('id', projectId)
  if (error) throw new Error(`Could not save project ${projectId}: ${error.message}`)
}

function target(project: OwnedProject): ProvisionTarget {
  return {
    projectId: project.id,
    userId: project.user_id,
    sandboxId: project.sandbox_id,
    save: (patch) => saveProject(project.id, patch),
  }
}

/** Fire-and-forget: errors are already recorded on the project row by the job itself. */
const background = (job: Promise<unknown>) => void job.catch(() => undefined)

/**
 * Creates a project from the user's first prompt and returns immediately. In the background the
 * AI names it and its sandbox is created; the prompt stays queued until the agent runs it.
 */
export const createProject = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(z.object({ prompt: z.string().trim().min(2).max(PROMPT_MAX_LENGTH) }))
  .handler(({ data, context }) =>
    safely('createProject', async () => {
      const db = supabaseAdmin()
      const userId = context.user.id
      const { MAX_PROJECTS_PER_USER } = serverEnv()

      const { count, error: countError } = await db
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
      if (countError) throw countError
      if ((count ?? 0) >= MAX_PROJECTS_PER_USER) {
        throw new AppError(
          `You can have up to ${MAX_PROJECTS_PER_USER} projects. Delete one to create another.`,
          'limit',
        )
      }

      const { data: project, error } = await db
        .from('projects')
        .insert({ user_id: userId, name: nameFromPrompt(data.prompt), prompt: data.prompt })
        .select('id, user_id, status, sandbox_id')
        .single<OwnedProject>()
      if (error) throw error

      background(generateProjectName(data.prompt).then((name) => saveProject(project.id, { name })))
      background(ensureProvisioned(target(project)))
      return { id: project.id }
    }),
  )

/**
 * Called when a project page opens. Resumes an interrupted setup (e.g. after a deploy) or wakes a
 * ready sandbox and makes sure its preview server runs. Failed setups only restart via `retry`.
 */
export const openProject = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(ProjectIdInput)
  .handler(({ data, context }) =>
    safely('openProject', async () => {
      const project = await ownedProject(context.user.id, data.projectId)
      if (isBusy(project.id)) return { ok: true }
      if (project.status === 'provisioning') background(ensureProvisioned(target(project)))
      if (project.status === 'ready') background(ensureRunning(target(project)))
      return { ok: true }
    }),
  )

/** Retries a failed setup. Reuses the sandbox when it still exists. */
export const retryProject = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(ProjectIdInput)
  .handler(({ data, context }) =>
    safely('retryProject', async () => {
      const project = await ownedProject(context.user.id, data.projectId)
      if (project.status !== 'failed' || isBusy(project.id)) return { ok: true }
      await saveProject(project.id, { status: 'provisioning', error: null })
      background(ensureProvisioned(target(project)))
      return { ok: true }
    }),
  )

/** Deletes the project and its sandbox. */
export const deleteProject = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(ProjectIdInput)
  .handler(({ data, context }) =>
    safely('deleteProject', async () => {
      const project = await ownedProject(context.user.id, data.projectId)
      // Sandbox first: if this fails the row stays, so the sandbox is never orphaned.
      if (project.sandbox_id) await deleteInstance(project.sandbox_id)
      const { error } = await supabaseAdmin().from('projects').delete().eq('id', project.id)
      if (error) throw error
      return { ok: true }
    }),
  )
