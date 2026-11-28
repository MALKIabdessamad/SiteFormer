/**
 * Restores a project to one of its agent runs' checkpoints, and takes back the latest message to
 * send it again edited. Lives with the agent feature: a checkpoint is a run's before/after commit.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { restoreCheckpoint } from '~/lib/server/agent/checkpoints.server'
import { getRunRow } from '~/lib/server/agent/persistence.server'
import { hasActiveRun } from '~/lib/server/agent/runner.server'
import {
  appendAssistantNote,
  latestRun,
  withdrawLatestMessage,
} from '~/lib/server/agent/transcript.server'
import { projectSession } from '~/lib/server/agent/sandbox-session.server'
import { requireCredits } from '~/lib/server/billing/credits.server'
import { AppError, safely } from '~/lib/server/errors.server'
import { log } from '~/lib/server/log.server'
import { ownedProject } from '~/lib/server/projects.server'
import { requireUser } from '~/lib/server/require-user'
import { serialQueue } from '~/lib/server/serial'
import { validate } from '~/lib/server/validate'
import { messageLabel } from '../lib/references'

const RUN_ID = /^[A-Za-z0-9_-]{8,100}$/

const RestoreInput = validate(
  z.object({
    projectId: z.uuid('Project not found.'),
    runId: z.string().regex(RUN_ID, 'Checkpoint not found.'),
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
      const label = messageLabel(run.prompt, 80) || 'your message'
      await appendAssistantNote(
        project.id,
        `↩︎ Restored the project to the checkpoint ${data.point} “${label}”. Changes made after that point were undone.`,
      )
      return { ok: true }
    }),
  )

const RewindInput = validate(
  z.object({
    projectId: z.uuid('Project not found.'),
    runId: z.string().regex(RUN_ID, 'Message not found.'),
  }),
)

// One rewind at a time per project (a double click never takes back two messages).
const oneAtATime = serialQueue()

/**
 * Takes back the latest message so it can be sent again, edited: the project goes back to how it
 * was before that message (when it changed anything), and the message leaves the conversation
 * with its reply. The browser sends the new version right after.
 */
export const rewindLatestMessage = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(RewindInput)
  .handler(({ data, context }) =>
    safely('rewindLatestMessage', () =>
      oneAtATime(data.projectId, async () => {
        const project = await ownedProject(context.user.id, data.projectId)
        // The new version has to be able to run before anything is undone.
        await requireCredits(context.user.id)
        if (await hasActiveRun(project.id)) {
          throw new AppError('Stop the agent before editing your message.', 'limit')
        }
        const run = await latestRun(project.id)
        if (!run || run.id !== data.runId) {
          throw new AppError('Only your latest message can be edited.', 'limit')
        }
        if (run.checkpoint_before) {
          if (project.status !== 'ready' || !project.sandbox_id) {
            throw new AppError('The sandbox is not ready yet.', 'unavailable')
          }
          await restoreCheckpoint(
            projectSession({ ...project, sandbox_id: project.sandbox_id }, run.id),
            run.checkpoint_before,
          )
        }
        await withdrawLatestMessage(run)
        log.info('Message taken back to edit', {
          event: 'agent.message_rewound',
          projectId: project.id,
          userId: context.user.id,
          runId: run.id,
          restored: Boolean(run.checkpoint_before),
        })
        return { ok: true }
      }),
    ),
  )
