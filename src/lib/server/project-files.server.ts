/**
 * The user's own edits to project files (Code tab, visual editor): the project must be theirs and
 * its sandbox ready; paths stay inside the project and out of git internals, installed packages
 * and SiteFormer's editor support.
 */
import { createHash } from 'node:crypto'
import {
  projectSession,
  relativePath,
  sh,
  shellQuote,
  sitePath,
  ToolError,
  type SandboxSession,
} from './agent/sandbox-session.server'
import { AppError } from './errors.server'
import { ownedProject } from './projects.server'

/** Files above this open read-only (and can't be saved from the editor). */
export const MAX_EDIT_BYTES = 1_000_000

export const sha1 = (text: string) => createHash('sha1').update(text).digest('hex')

/** A path the user may edit: inside the project, not git internals or installed packages. */
export function editablePath(input: string): string {
  let absolute: string
  try {
    absolute = sitePath(input)
  } catch (error) {
    throw new AppError(error instanceof ToolError ? error.message : 'Invalid path.')
  }
  const rel = relativePath(absolute)
  if (/^(node_modules|\.git|\.siteformer)(\/|$)/.test(rel)) {
    throw new AppError('This folder can’t be edited.')
  }
  return absolute
}

/** A session in the user's ready project sandbox. `allow` caps calls per user. */
export async function sessionFor(
  userId: string,
  projectId: string,
  allow: (key: string) => boolean,
): Promise<SandboxSession> {
  if (!allow(userId)) throw new AppError('Too many requests. Wait a moment.', 'limit')
  const project = await ownedProject(userId, projectId)
  if (project.status !== 'ready' || !project.sandbox_id) {
    throw new AppError('The sandbox is not ready yet.', 'unavailable')
  }
  return projectSession({ ...project, sandbox_id: project.sandbox_id }, `manual-${Date.now()}`)
}

export type FileRead =
  | { kind: 'missing' }
  | { kind: 'binary'; size: number }
  | { kind: 'large'; size: number }
  | { kind: 'text'; content: string; size: number }

export async function readFile(session: SandboxSession, absolute: string): Promise<FileRead> {
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
