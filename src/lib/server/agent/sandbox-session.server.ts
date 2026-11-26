/**
 * Everything the agent's tools need to act inside ONE project's sandbox, safely and cheaply:
 * path confinement, shell execution with in-sandbox timeouts, and output caps (tokens!).
 */
import { serverEnv } from '../env.server'
import { exec, SandboxError, shellQuote, type ExecResult } from '../sandbox/agent37.server'
import { SITE_DIR } from '../sandbox/provision.server'

export { shellQuote }

export type SandboxSession = {
  sandboxId: string
  projectId: string
  userId: string
  runId: string
  /** Aborts when the user presses Stop. */
  signal: AbortSignal
  /** Port of the starter's dev server. */
  previewPort: number
  /** Screenshots the model should see on its next call (consumed by the vision middleware). */
  pendingImages: Array<{ mediaType: string; base64: string; caption: string }>
  /** Count of screenshots taken this run (storage file names + per-run budget). */
  screenshotCount: number
  /** Bumped whenever a tool may have changed project files (write/edit/delete/move/command). */
  workspaceVersion: number
  /** Workspace version at each page+viewport's last screenshot (skip identical re-shots). */
  screenshotVersions: Map<string, number>
  /** Last check_project result and the workspace version it was taken at. */
  lastCheck: { version: number; result: Record<string, unknown> } | null
  /** Per-run usage of paid / token-heavy tools (budgets). */
  usage: { imagesGenerated: number; webSearches: number; imageViews: number }
  /** The project's uploads by id (maps "sf-upload:<id>" parts to names and project paths). */
  uploads: Map<
    string,
    { name: string; kind: 'image' | 'document'; mime: string; project_path: string | null }
  >
  /** Images attached to THIS run's message, shown to the model on every call of the run. */
  attachedImages: Map<string, { mime: string; base64: string }>
  /** Project paths read with read_file in this run (edit_file failure hints). */
  readPaths: Set<string>
  /** Chat mode: text of this run's attached documents (they aren't copied into the project). */
  attachedTexts: Map<string, string>
}

/**
 * A session on a project's sandbox with fresh per-run bookkeeping. `runId` labels logs and
 * screenshot folders; `signal` cancels its commands (the user pressed Stop).
 */
export function projectSession(
  project: { id: string; user_id: string; sandbox_id: string },
  runId: string,
  signal: AbortSignal = new AbortController().signal,
): SandboxSession {
  return {
    sandboxId: project.sandbox_id,
    projectId: project.id,
    userId: project.user_id,
    runId,
    signal,
    previewPort: serverEnv().STARTER_PORT,
    pendingImages: [],
    screenshotCount: 0,
    workspaceVersion: 0,
    screenshotVersions: new Map(),
    lastCheck: null,
    usage: { imagesGenerated: 0, webSearches: 0, imageViews: 0 },
    uploads: new Map(),
    attachedImages: new Map(),
    readPaths: new Set(),
    attachedTexts: new Map(),
  }
}

/** Tool-facing error: its message is returned to the model so it can correct itself. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolError'
  }
}

// eslint-disable-next-line no-control-regex -- stripping terminal colour codes from command output
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g

/** Keeps the start and (mostly) the end of long output, where errors usually are. */
export function capText(text: string, max: number): string {
  const clean = text.replace(ANSI, '').replace(/\r/g, '')
  if (clean.length <= max) return clean
  const head = Math.floor(max * 0.25)
  const tail = max - head
  return `${clean.slice(0, head)}\n… [${clean.length - max} characters omitted] …\n${clean.slice(-tail)}`
}

/**
 * Resolves a project-relative path and refuses anything outside the project, inside `.git`, or
 * with control characters. Returns the absolute path inside the sandbox.
 */
export function sitePath(input: string, { allowRoot = false } = {}): string {
  const raw = input.trim().replace(/\\/g, '/')
  // eslint-disable-next-line no-control-regex -- reject control characters in paths
  if (!raw || /[\0-\x1f]/.test(raw)) throw new ToolError(`Invalid path: ${JSON.stringify(input)}`)
  let relative: string
  if (raw === SITE_DIR || raw.startsWith(`${SITE_DIR}/`)) {
    relative = raw.slice(SITE_DIR.length) // absolute path inside the project: accepted
  } else if (raw.startsWith('/') || raw.startsWith('~')) {
    throw new ToolError(`Use paths relative to the project root, e.g. "src/routes/index.tsx".`)
  } else {
    relative = raw
  }
  const parts: Array<string> = []
  for (const part of relative.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') throw new ToolError('Paths must stay inside the project (no "..").')
    parts.push(part)
  }
  if (parts[0] === '.git') throw new ToolError('The .git folder is managed by the app.')
  if (parts.length === 0 && !allowRoot) throw new ToolError('Path points at the project root.')
  return parts.length ? `${SITE_DIR}/${parts.join('/')}` : SITE_DIR
}

/** Project-relative form of an absolute sandbox path (for messages to the model). */
export const relativePath = (absolute: string) => absolute.slice(SITE_DIR.length + 1) || '.'

const ENV = 'export PATH="$HOME/.bun/bin:$PATH" CI=1 GIT_TERMINAL_PROMPT=0 FORCE_COLOR=0 NO_COLOR=1'

/**
 * Runs a bash script in the project folder. `timeoutSeconds` is enforced INSIDE the sandbox
 * (`timeout`), so a hung command is killed there too, not just abandoned by us.
 */
export async function sh(
  session: SandboxSession,
  script: string,
  { timeoutSeconds = 120, cwd = SITE_DIR }: { timeoutSeconds?: number; cwd?: string } = {},
): Promise<ExecResult> {
  if (session.signal.aborted) throw new SandboxError('Cancelled.')
  const wrapped = `${ENV}; cd ${shellQuote(cwd)} && timeout -k 5 ${timeoutSeconds} bash -c ${shellQuote(script)}`
  const result = await exec(
    session.sandboxId,
    wrapped,
    (timeoutSeconds + 30) * 1000,
    session.signal,
  )
  if (result.exitCode === 124) {
    return { ...result, stderr: `${result.stderr}\n[timed out after ${timeoutSeconds}s]` }
  }
  return result
}

const CHUNK = 64_000

/** Reads a file as UTF-8 text. */
export async function readText(session: SandboxSession, absolute: string): Promise<string> {
  const result = await sh(
    session,
    `if [ ! -f ${shellQuote(absolute)} ]; then echo __MISSING__; exit 0; fi; ` +
      `size=$(stat -c %s ${shellQuote(absolute)}); if [ "$size" -gt 2000000 ]; then echo __TOO_BIG__; exit 0; fi; ` +
      `base64 -w0 ${shellQuote(absolute)}`,
    { timeoutSeconds: 30 },
  )
  const out = result.stdout.trim()
  if (out === '__MISSING__') throw new ToolError(`File not found: ${relativePath(absolute)}`)
  if (out === '__TOO_BIG__') throw new ToolError(`${relativePath(absolute)} is over 2 MB.`)
  if (result.exitCode !== 0) throw new ToolError(`Could not read ${relativePath(absolute)}.`)
  return Buffer.from(out, 'base64').toString('utf8')
}

/** Writes UTF-8 text (creating folders). Large files are sent in chunks. */
export async function writeText(session: SandboxSession, absolute: string, content: string) {
  await writeBytes(session, absolute, Buffer.from(content, 'utf8'))
}

/** Reads a file's raw bytes (max `maxBytes`). */
export async function readBytes(
  session: SandboxSession,
  absolute: string,
  maxBytes = 8_000_000,
): Promise<Buffer> {
  const result = await sh(
    session,
    `if [ ! -f ${shellQuote(absolute)} ]; then echo __MISSING__; exit 0; fi; ` +
      `size=$(stat -c %s ${shellQuote(absolute)}); if [ "$size" -gt ${maxBytes} ]; then echo __TOO_BIG__; exit 0; fi; ` +
      `base64 -w0 ${shellQuote(absolute)}`,
    { timeoutSeconds: 60 },
  )
  const out = result.stdout.trim()
  if (out === '__MISSING__') throw new ToolError(`File not found: ${relativePath(absolute)}`)
  if (out === '__TOO_BIG__') throw new ToolError(`${relativePath(absolute)} is too large.`)
  if (result.exitCode !== 0) throw new ToolError(`Could not read ${relativePath(absolute)}.`)
  return Buffer.from(out, 'base64')
}

/** Writes raw bytes (creating folders). Large files are sent in chunks. */
export async function writeBytes(session: SandboxSession, absolute: string, bytes: Uint8Array) {
  const b64 = Buffer.from(bytes).toString('base64')
  const dir = absolute.slice(0, absolute.lastIndexOf('/'))
  const tmp = `/tmp/sf-write-${crypto.randomUUID()}.b64`
  for (let i = 0; i < b64.length || i === 0; i += CHUNK) {
    const op = i === 0 ? '>' : '>>'
    const r = await sh(session, `printf %s ${shellQuote(b64.slice(i, i + CHUNK))} ${op} ${tmp}`, {
      timeoutSeconds: 30,
    })
    if (r.exitCode !== 0) throw new ToolError(`Could not write ${relativePath(absolute)}.`)
    if (b64.length === 0) break
  }
  const done = await sh(
    session,
    `mkdir -p ${shellQuote(dir)} && base64 -d ${tmp} > ${shellQuote(absolute)}; s=$?; rm -f ${tmp}; exit $s`,
    { timeoutSeconds: 30 },
  )
  if (done.exitCode !== 0) throw new ToolError(`Could not write ${relativePath(absolute)}.`)
  session.workspaceVersion += 1
}
