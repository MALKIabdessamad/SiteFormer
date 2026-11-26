/**
 * The Code tab: list, read and save the project's files in its sandbox, as the verified owner.
 *
 * A save is refused while the agent is working (it would race the agent's own edits) and when
 * the file changed since the user opened it (`baseHash`). Each save is committed as a checkpoint
 * and noted in the chat, so the user sees it and the agent knows to re-read the file.
 */
import { createHash } from 'node:crypto'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { commitAll, ensureRepo } from '~/lib/server/agent/checkpoints.server'
import { appendAssistantNote, hasActiveRun } from '~/lib/server/agent/runner.server'
import {
  createSession,
  relativePath,
  sh,
  shellQuote,
  sitePath,
  ToolError,
  writeText,
  type SandboxSession,
} from '~/lib/server/agent/sandbox-session.server'
import { restartDevServer } from '~/lib/server/agent/tools/shell.server'
import { serverEnv } from '~/lib/server/env.server'
import { AppError, safely } from '~/lib/server/errors.server'
import { log } from '~/lib/server/log.server'
import { ownedProject } from '~/lib/server/projects.server'
import { requireUser } from '~/lib/server/require-user'
import { validate } from '~/lib/server/validate'

const MAX_FILES = 2000
/** Files above this open read-only (and can't be saved from the editor). */
const MAX_EDIT_BYTES = 1_000_000

const sha1 = (text: string) => createHash('sha1').update(text).digest('hex')

const ListInput = validate(z.object({ projectId: z.uuid('Project not found.') }))
const ReadInput = validate(
  z.object({ projectId: z.uuid('Project not found.'), path: z.string().min(1).max(500) }),
)
const SaveInput = validate(
  z.object({
    projectId: z.uuid('Project not found.'),
    path: z.string().min(1).max(500),
    content: z.string().max(MAX_EDIT_BYTES, 'This file is too large to save from the editor.'),
    baseHash: z.string().regex(/^[0-9a-f]{40}$/),
  }),
)

/** A path the editor may touch: inside the project, not git internals or installed packages. */
function editablePath(input: string): string {
  let absolute: string
  try {
    absolute = sitePath(input)
  } catch (error) {
    throw new AppError(error instanceof ToolError ? error.message : 'Invalid path.')
  }
  const rel = relativePath(absolute)
  if (/^(node_modules|\.git)(\/|$)/.test(rel)) throw new AppError('This folder can’t be edited.')
  return absolute
}

async function sessionFor(userId: string, projectId: string): Promise<SandboxSession> {
  const project = await ownedProject(userId, projectId)
  if (project.status !== 'ready' || !project.sandbox_id) {
    throw new AppError('The sandbox is not ready yet.', 'unavailable')
  }
  return createSession({
    sandboxId: project.sandbox_id,
    projectId: project.id,
    userId: project.user_id,
    runId: `manual-${Date.now()}`,
    signal: new AbortController().signal,
    previewPort: serverEnv().STARTER_PORT,
  })
}

type FileRead =
  | { kind: 'missing' }
  | { kind: 'binary'; size: number }
  | { kind: 'large'; size: number }
  | { kind: 'text'; content: string; size: number }

async function readFile(session: SandboxSession, absolute: string): Promise<FileRead> {
  const q = shellQuote(absolute)
  const result = await sh(
    session,
    `if [ ! -f ${q} ]; then echo MISSING; exit 0; fi; size=$(stat -c %s ${q}); ` +
      `if grep -qI . ${q} || [ "$size" -eq 0 ]; then kind=text; else kind=binary; fi; ` +
      `echo "$kind $size"; if [ "$kind" = text ] && [ "$size" -le ${MAX_EDIT_BYTES} ]; then base64 -w0 ${q}; fi`,
    { timeoutSeconds: 30 },
  )
  const [head = '', body = ''] = result.stdout.split('\n')
  if (head.trim() === 'MISSING') return { kind: 'missing' }
  const [kind, sizeText] = head.trim().split(' ')
  const size = Number(sizeText) || 0
  if (result.exitCode !== 0) throw new Error(`Could not read ${relativePath(absolute)}`)
  if (kind === 'binary') return { kind: 'binary', size }
  if (size > MAX_EDIT_BYTES) return { kind: 'large', size }
  return { kind: 'text', size, content: Buffer.from(body.trim(), 'base64').toString('utf8') }
}

/** The project's files (git-tracked plus new, ignoring node_modules/build output). */
export const listProjectFiles = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(ListInput)
  .handler(({ data, context }) =>
    safely('listProjectFiles', async () => {
      const session = await sessionFor(context.user.id, data.projectId)
      const result = await sh(
        session,
        `if [ -d .git ]; then git ls-files --cached --others --exclude-standard; ` +
          `else find . -type f -not -path './node_modules/*' -not -path './.git/*' | sed 's|^./||'; fi ` +
          `| sort | head -${MAX_FILES + 1}`,
        { timeoutSeconds: 30 },
      )
      const files = result.stdout.split('\n').filter(Boolean)
      return { files: files.slice(0, MAX_FILES), truncated: files.length > MAX_FILES }
    }),
  )

/** One file's content (text up to 1 MB) and its hash, used to detect conflicting saves. */
export const readProjectFile = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(ReadInput)
  .handler(({ data, context }) =>
    safely('readProjectFile', async () => {
      const session = await sessionFor(context.user.id, data.projectId)
      const file = await readFile(session, editablePath(data.path))
      if (file.kind === 'missing') throw new AppError('This file no longer exists.', 'not_found')
      if (file.kind !== 'text') return { kind: file.kind, size: file.size }
      return {
        kind: 'text' as const,
        size: file.size,
        content: file.content,
        hash: sha1(file.content),
      }
    }),
  )

/** Saves a file edited by the user, commits it as a checkpoint and notes it in the chat. */
export const saveProjectFile = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(SaveInput)
  .handler(({ data, context }) =>
    safely('saveProjectFile', async () => {
      const absolute = editablePath(data.path)
      const session = await sessionFor(context.user.id, data.projectId)
      if (await hasActiveRun(data.projectId)) {
        throw new AppError('The agent is working. Save when it’s done.', 'limit')
      }
      const current = await readFile(session, absolute)
      if (current.kind === 'missing') throw new AppError('This file no longer exists.', 'not_found')
      if (current.kind !== 'text') throw new AppError('This file can’t be edited here.')
      if (sha1(current.content) !== data.baseHash) {
        throw new AppError(
          'This file changed since you opened it (the agent may have edited it). Reload it, then redo your change.',
          'limit',
        )
      }
      const path = relativePath(absolute)
      if (current.content === data.content) return { saved: false, hash: data.baseHash }

      await writeText(session, absolute, data.content)
      const stat = await sh(session, `git diff --numstat -- ${shellQuote(absolute)} 2>/dev/null`, {
        timeoutSeconds: 30,
      })
      const [added = '0', removed = '0'] = stat.stdout.trim().split(/\s+/)
      // Dependencies or build config changed: install / restart so the preview keeps working.
      if (/^(package\.json|bun\.lockb?)$/.test(path)) {
        const install = await sh(session, 'bun install 2>&1 | tail -15', { timeoutSeconds: 300 })
        if (install.exitCode !== 0) {
          log.warn('bun install after manual edit failed', {
            event: 'code.install_failed',
            projectId: data.projectId,
            output: install.stdout.slice(-500),
          })
        }
        await restartDevServer(session)
      } else if (
        /^(vite|tailwind|postcss)\.config\.[cm]?[jt]s$|^tsconfig.*\.json$|^\.env/.test(path)
      ) {
        await restartDevServer(session)
      }
      await ensureRepo(session)
      await commitAll(session, `Manual edit: ${path}`)
      await appendAssistantNote(
        data.projectId,
        `✎ You edited ${path} by hand (+${Number(added) || 0} −${Number(removed) || 0} lines). Saved as a checkpoint.`,
      )
      log.info('File edited by the user', {
        event: 'code.saved',
        projectId: data.projectId,
        userId: context.user.id,
        path,
        added: Number(added) || 0,
        removed: Number(removed) || 0,
      })
      return { saved: true, hash: sha1(data.content) }
    }),
  )
