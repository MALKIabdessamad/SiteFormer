/**
 * Restores a project to one of its agent runs' checkpoints. Lives with the agent feature: a
 * checkpoint is a run's before/after commit.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { restoreCheckpoint } from '~/lib/server/agent/checkpoints.server'
import { getRunRow } from '~/lib/server/agent/persistence.server'
import { appendAssistantNote, hasActiveRun } from '~/lib/server/agent/runner.server'
import { projectSession } from '~/lib/server/agent/sandbox-session.server'
import { AppError, safely } from '~/lib/server/errors.server'
import { ownedProject } from '~/lib/server/projects.server'
import { requireUser } from '~/lib/server/require-user'
import { validate } from '~/lib/server/validate'

const RestoreInput = validate(
  z.object({
    projectId: z.uuid('Project not found.'),
    runId: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/, 'Checkpoint not found.'),
    point: z.enum(['before', 'after']),
  }),
)

/**
 * Restores the project to the state right `before` a run or right `after` it. The restore is
 * itself a new commit, so it can be undone the same way.
 */
export const restoreToCheckpoint = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(RestoreInput)
  .handler(({ data, context }) =>
    safely('restoreToCheckpoint', async () => {
      const project = await ownedProject(context.user.id, data.projectId)
      const run = await getRunRow(data.runId)
      if (!run || run.project_id !== project.id)
        throw new AppError('Checkpoint not found.', 'not_found')
      const sha = data.point === 'before' ? run.checkpoint_before : run.checkpoint_after
      if (!sha) throw new AppError('This message has no checkpoint.', 'not_found')
      if (project.status !== 'ready' || !project.sandbox_id) {
        throw new AppError('The sandbox is not ready yet.', 'unavailable')
      }
      if (await hasActiveRun(project.id)) {
        throw new AppError('Stop the agent before restoring.', 'limit')
      }
      await restoreCheckpoint(
        projectSession({ ...project, sandbox_id: project.sandbox_id }, run.id),
        sha,
      )
      const label = run.prompt.replace(/\s+/g, ' ').slice(0, 80)
      await appendAssistantNote(
        project.id,
        `↩︎ Restored the project to the checkpoint ${data.point} “${label}”. Changes made after that point were undone.`,
      )
      return { ok: true }
    }),
  )
