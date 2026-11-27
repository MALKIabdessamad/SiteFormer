/**
 * Server functions for the project lifecycle. They run on the server as the verified user and are
 * the only code that writes `projects` (with the secret key). Reads happen in the browser under
 * Row Level Security (see projects.queries.ts). Chat messages go through /api/agent.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { removeProjectScreenshots } from '~/lib/server/agent/screenshots.server'
import { removeProjectUploads, resolveUploads } from '~/lib/server/agent/uploads.server'
import {
  enqueueRun,
  hasActiveRun,
  newRunId,
  recoverRuns,
  stopProjectRuns,
} from '~/lib/server/agent/runner.server'
import { generateProjectName } from '~/lib/server/ai/naming.server'
import { requireCredits, type UserPlan } from '~/lib/server/billing/credits.server'
import { log } from '~/lib/server/log.server'
import { AppError, safely } from '~/lib/server/errors.server'
import { ownedProject, provisionTarget, saveProject } from '~/lib/server/projects.server'
import { rateLimiter } from '~/lib/server/rate-limit'
import { requireUser } from '~/lib/server/require-user'
import { deleteInstance } from '~/lib/server/sandbox/agent37.server'
import { ensureProvisioned, ensureRunning, isBusy } from '~/lib/server/sandbox/provision.server'
import { supabaseAdmin } from '~/lib/server/supabase-admin.server'
import { validate } from '~/lib/server/validate'
import { PROJECT_MODES, PROMPT_MAX_LENGTH, PROMPT_MIN_LENGTH } from '../lib/constants'
import { nameFromPrompt } from '../lib/project-name'

const ProjectIdInput = validate(z.object({ projectId: z.uuid('Project not found.') }))

const ModeInput = validate(
  z.object({ projectId: z.uuid('Project not found.'), mode: z.enum(PROJECT_MODES) }),
)
const allowModeChange = rateLimiter(60)

const CreateInput = validate(
  z.object({
    prompt: z
      .string('Describe the site you want to build.')
      .trim()
      .min(PROMPT_MIN_LENGTH, 'Describe your site in a few more words.')
      .max(PROMPT_MAX_LENGTH, `Keep the description under ${PROMPT_MAX_LENGTH} characters.`),
    /** The browser will attach files first, then call startFirstRun. */
    deferRun: z.boolean().optional(),
  }),
)

const FirstRunInput = validate(
  z.object({
    projectId: z.uuid('Project not found.'),
    uploadIds: z.array(z.uuid('Attachment not found.')).max(6, 'Attach up to 6 files.'),
  }),
)

function projectLimitError(plan: UserPlan): AppError {
  const what = `The ${plan.planName} plan includes up to ${plan.maxProjects} projects.`
  return new AppError(
    plan.plan === 'max'
      ? `${what} Delete one to create another.`
      : `${what} Upgrade your plan or delete a project to create another.`,
    'limit',
  )
}

/** Fire-and-forget: errors are already recorded (project row / run row) by the job itself. */
const background = (job: Promise<unknown>) => void job.catch(() => undefined)

/**
 * Creates a project from the user's first prompt and returns immediately. In the background the
 * AI names it, its sandbox is created, and the prompt is queued as the agent's first run (it
 * starts as soon as the sandbox is ready).
 */
export const createProject = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(CreateInput)
  .handler(({ data, context }) =>
    safely('createProject', async () => {
      const db = supabaseAdmin()
      const userId = context.user.id
      // Plan limits: projects per plan, and credits to run the first message.
      const plan = await requireCredits(userId)
      const { count, error: countError } = await db
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
      if (countError) throw countError
      if ((count ?? 0) >= plan.maxProjects) throw projectLimitError(plan)

      const { data: project, error } = await db
        .from('projects')
        .insert({ user_id: userId, name: nameFromPrompt(data.prompt), prompt: data.prompt })
        .select('id, user_id, sandbox_id')
        .single<{ id: string; user_id: string; sandbox_id: string | null }>()
      // The database enforces the limit too (race-proof, see migration 12).
      if (error?.message === 'project_limit') throw projectLimitError(plan)
      if (error) throw error

      if (!data.deferRun) {
        await enqueueRun({ runId: newRunId(), projectId: project.id, userId, prompt: data.prompt })
      }
      log.info('Project created', { event: 'project.created', projectId: project.id, userId })
      background(generateProjectName(data.prompt).then((name) => saveProject(project.id, { name })))
      background(ensureProvisioned(provisionTarget(project)))
      return { id: project.id }
    }),
  )

/**
 * Starts a project's first run with files the user attached on the dashboard (createProject was
 * called with deferRun). Only once per project: later messages go through the chat.
 */
export const startFirstRun = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(FirstRunInput)
  .handler(({ data, context }) =>
    safely('startFirstRun', async () => {
      const project = await ownedProject(context.user.id, data.projectId)
      const db = supabaseAdmin()
      const { count } = await db
        .from('agent_runs')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', project.id)
      if ((count ?? 0) > 0) return { ok: true } // already started (double click / retry)
      const { data: row, error } = await db
        .from('projects')
        .select('prompt')
        .eq('id', project.id)
        .single<{ prompt: string }>()
      if (error) throw error
      const attachments = await resolveUploads(data.uploadIds, project.id, context.user.id)
      try {
        await enqueueRun({
          runId: newRunId(),
          projectId: project.id,
          userId: context.user.id,
          prompt: row.prompt,
          attachments,
        })
      } catch (error) {
        // A parallel call (double click) already started it.
        if (error instanceof AppError && error.code === 'limit' && (await hasActiveRun(project.id)))
          return { ok: true }
        throw error
      }
      return { ok: true }
    }),
  )

/**
 * Called when a project page opens. Resumes an interrupted setup (e.g. after a deploy), wakes a
 * ready sandbox and its preview server, and resumes agent runs a restart left unfinished.
 * Failed setups only restart via `retryProject`.
 */
export const openProject = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(ProjectIdInput)
  .handler(({ data, context }) =>
    safely('openProject', async () => {
      const project = await ownedProject(context.user.id, data.projectId)
      background(recoverRuns(project.id))
      if (project.status === 'provisioning' && !isBusy(project.id)) {
        background(ensureProvisioned(provisionTarget(project)))
      }
      // A sandbox that went to sleep wakes up here (and its dev server restarts if it stopped):
      // the page shows the preview once this returns, never a sandbox that isn't up yet.
      if (project.status === 'ready') await ensureRunning(provisionTarget(project))
      return { ok: true }
    }),
  )

/** Saves the composer mode (Build / Chat) the user picked for this project. */
export const setProjectMode = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(ModeInput)
  .handler(({ data, context }) =>
    safely('setProjectMode', async () => {
      if (!allowModeChange(context.user.id)) {
        throw new AppError('Too many changes. Wait a moment.', 'limit')
      }
      const project = await ownedProject(context.user.id, data.projectId)
      if (project.mode !== data.mode) await saveProject(project.id, { mode: data.mode })
      return { mode: data.mode }
    }),
  )

/** Retries a failed setup. Reuses the sandbox when it still exists. A queued message then runs. */
export const retryProject = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(ProjectIdInput)
  .handler(({ data, context }) =>
    safely('retryProject', async () => {
      const project = await ownedProject(context.user.id, data.projectId)
      if (project.status !== 'failed' || isBusy(project.id)) return { ok: true }
      await saveProject(project.id, { status: 'provisioning', error: null })
      background(ensureProvisioned(provisionTarget(project)))
      return { ok: true }
    }),
  )

/** Deletes the project and its sandbox (stopping the agent first). */
export const deleteProject = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(ProjectIdInput)
  .handler(({ data, context }) =>
    safely('deleteProject', async () => {
      const project = await ownedProject(context.user.id, data.projectId)
      await stopProjectRuns(project.id, context.user.id)
      // Sandbox first: if this fails the row stays, so the sandbox is never orphaned.
      if (project.sandbox_id) await deleteInstance(project.sandbox_id)
      const { error } = await supabaseAdmin().from('projects').delete().eq('id', project.id)
      if (error) throw error
      await removeProjectScreenshots(project.id)
      await removeProjectUploads(project.id)
      log.info('Project deleted', {
        event: 'project.deleted',
        projectId: project.id,
        userId: context.user.id,
      })
      return { ok: true }
    }),
  )
