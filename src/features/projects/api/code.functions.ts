/**
 * The Code tab: list, read and save the project's files in its sandbox, as the verified owner.
 * Also lists the site's pages for the preview's path bar.
 *
 * A save is refused while the agent is working (it would race the agent's own edits) and when
 * the file changed since the user opened it (`baseHash`). Each save is committed as a checkpoint
 * and noted in the chat, so the user sees it and the agent knows to re-read the file.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { commitAll, ensureRepo } from '~/lib/server/agent/checkpoints.server'
import { appendAssistantNote, hasActiveRun } from '~/lib/server/agent/runner.server'
import { relativePath, sh, shellQuote, writeText } from '~/lib/server/agent/sandbox-session.server'
import { restartDevServer } from '~/lib/server/agent/tools/shell.server'
import { AppError, safely } from '~/lib/server/errors.server'
import { log } from '~/lib/server/log.server'
import {
  editablePath,
  MAX_EDIT_BYTES,
  readFile,
  sessionFor,
  sha1,
} from '~/lib/server/project-files.server'
import { rateLimiter } from '~/lib/server/rate-limit'
import { requireUser } from '~/lib/server/require-user'
import { validate } from '~/lib/server/validate'
import { sitePages } from '../lib/site-pages'

const MAX_FILES = 2000

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

// Every call runs a command in the sandbox: cap them per user.
const allowRead = rateLimiter(120)
const allowSave = rateLimiter(30)

/** The project's files (git-tracked plus new, ignoring node_modules/build output). */
export const listProjectFiles = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(ListInput)
  .handler(({ data, context }) =>
    safely('listProjectFiles', async () => {
      const session = await sessionFor(context.user.id, data.projectId, allowRead)
      const result = await sh(
        session,
        `if [ -d .git ]; then git ls-files --cached --others --exclude-standard; ` +
          `else find . -type f -not -path './node_modules/*' -not -path './.git/*' | sed 's|^./||'; fi ` +
          `| grep -v '^\\.siteformer/' | sort | head -${MAX_FILES + 1}`,
        { timeoutSeconds: 30 },
      )
      const files = result.stdout.split('\n').filter(Boolean)
      return { files: files.slice(0, MAX_FILES), truncated: files.length > MAX_FILES }
    }),
  )

/** The site's pages, from the route tree its dev server generates (none until it exists). */
export const listSitePages = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(ListInput)
  .handler(({ data, context }) =>
    safely('listSitePages', async () => {
      const session = await sessionFor(context.user.id, data.projectId, allowRead)
      // Only the route interfaces (a few lines), not the whole generated file.
      const result = await sh(
        session,
        `sed -n '/^export interface FileRoutesBy/,/^}/p' src/routeTree.gen.ts 2>/dev/null || true`,
        { timeoutSeconds: 15 },
      )
      return { pages: sitePages(result.stdout) }
    }),
  )

/** One file's content (text up to 1 MB) and its hash, used to detect conflicting saves. */
export const readProjectFile = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(ReadInput)
  .handler(({ data, context }) =>
    safely('readProjectFile', async () => {
      const session = await sessionFor(context.user.id, data.projectId, allowRead)
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
      const session = await sessionFor(context.user.id, data.projectId, allowSave)
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
      if (current.content === data.content) {
        return { saved: false, hash: data.baseHash, note: null }
      }

      await writeText(session, absolute, data.content)
      const stat = await sh(session, `git diff --numstat -- ${shellQuote(absolute)} 2>/dev/null`, {
        timeoutSeconds: 30,
      })
      const [added = '0', removed = '0'] = stat.stdout.trim().split(/\s+/)
      // Dependencies or build config changed: install / restart so the preview keeps working.
      if (/^(package\.json|bun\.lockb?)$/.test(path)) {
        const install = await sh(session, 'set -o pipefail; bun install 2>&1 | tail -15', {
          timeoutSeconds: 300,
        })
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
      const note = `✎ You edited ${path} by hand (+${Number(added) || 0} −${Number(removed) || 0} lines). Saved as a checkpoint.`
      await appendAssistantNote(data.projectId, note)
      log.info('File edited by the user', {
        event: 'code.saved',
        projectId: data.projectId,
        userId: context.user.id,
        path,
        added: Number(added) || 0,
        removed: Number(removed) || 0,
      })
      // The chat shows the note right away (the same text the transcript now ends with).
      return { saved: true, hash: sha1(data.content), note }
    }),
  )
