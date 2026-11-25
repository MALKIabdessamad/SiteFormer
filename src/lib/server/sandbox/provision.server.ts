import { serverEnv } from '../env.server'
import {
  createInstance,
  ensurePublicUrl,
  exec,
  getInstance,
  SandboxError,
  shellQuote,
} from './agent37.server'

/** Where the starter app lives inside the sandbox. */
export const SITE_DIR = '/home/node/site'
/** Port of the starter's dev server (STARTER_PORT, 8080 for the default starter). */
const previewPort = () => serverEnv().STARTER_PORT
const BUN_VERSION = '1.4.5'

export type SandboxPatch = {
  sandbox_id?: string | null
  preview_url?: string | null
  status?: 'provisioning' | 'ready' | 'failed'
  error?: string | null
}

export type ProvisionTarget = {
  projectId: string
  userId: string
  sandboxId: string | null
  /** Persists progress. Called right after the sandbox exists, and at the end. */
  save: (patch: SandboxPatch) => Promise<void>
}

/**
 * Idempotent setup script: installs Bun, clones the starter, installs dependencies and starts
 * the dev server. Every step checks whether it already happened, so a setup interrupted by a
 * deploy or a crash simply resumes. Total on a fresh sandbox: ~10s.
 */
function setupScript(): string {
  const { STARTER_REPO, STARTER_REF } = serverEnv()
  const branch = STARTER_REF ? `--branch ${shellQuote(STARTER_REF)} ` : ''
  return [
    'set -eu',
    'export PATH="$HOME/.bun/bin:$PATH"',
    // Never wait for interactive input (e.g. git asking for credentials on a bad repo URL).
    'export GIT_TERMINAL_PROMPT=0 CI=1',
    `SITE=${shellQuote(SITE_DIR)}`,
    // 1. Bun (pinned), for the starter's bun.lock.
    `if ! command -v bun >/dev/null 2>&1; then`,
    `  curl -fsSL https://bun.sh/install | bash -s ${shellQuote(`bun-v${BUN_VERSION}`)} >/tmp/bun-install.log 2>&1 || { tail -5 /tmp/bun-install.log >&2; exit 11; }`,
    `fi`,
    // 2. Starter, cloned into a temp dir and moved into place, so a half clone never counts.
    `if [ ! -f "$SITE/package.json" ]; then`,
    `  rm -rf "$SITE.tmp"`,
    `  git clone --quiet --depth 1 ${branch}${shellQuote(STARTER_REPO)} "$SITE.tmp" || exit 12`,
    `  rm -rf "$SITE.tmp/.git" && rm -rf "$SITE" && mv "$SITE.tmp" "$SITE"`,
    // Fresh history per project (lets the AI agent checkpoint and undo later).
    `  git -C "$SITE" init --quiet --initial-branch=main`,
    `  git -C "$SITE" add -A`,
    `  git -C "$SITE" -c user.name=SiteFormer -c user.email=agent@siteformer.invalid commit --quiet -m "Starter"`,
    `fi`,
    `cd "$SITE"`,
    // 3. Dependencies (lockfile first; fall back if the starter's lockfile is out of date).
    `if [ ! -x node_modules/.bin/vite ]; then`,
    `  (bun install --frozen-lockfile || bun install) >/tmp/install.log 2>&1 || { tail -15 /tmp/install.log >&2; exit 13; }`,
    `fi`,
    // 4. Dev server, unless it is already running. "[v]ite" keeps pgrep from matching itself.
    `if ! pgrep -f "[v]ite dev" >/dev/null 2>&1; then`,
    `  nohup bun run dev >/tmp/dev.log 2>&1 &`,
    `fi`,
    `echo setup-ok`,
  ].join('\n')
}

const STEP_ERRORS: Record<number, string> = {
  11: 'Could not install Bun in the sandbox.',
  12: 'Could not download the starter template.',
  13: 'Could not install the starter’s dependencies.',
}

/** Polls the dev server from inside the sandbox until it answers (any non-5xx status). */
async function waitForPreview(sandboxId: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  const probe = `curl -s -o /dev/null -m 10 -w '%{http_code}' http://localhost:${previewPort()}/`
  let last = ''
  while (Date.now() < deadline) {
    const result = await exec(sandboxId, probe, 30_000).catch(() => null)
    last = result?.stdout.trim() ?? ''
    const status = Number(last)
    if (status >= 200 && status < 500) return
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  const log = await exec(sandboxId, 'tail -20 /tmp/dev.log 2>/dev/null', 15_000).catch(() => null)
  console.error('[sandbox] preview did not start; last status', last || 'none', '\n', log?.stdout)
  throw new SandboxError('The preview server did not start.')
}

/** Creates (if needed) and fully sets up a project's sandbox. Safe to re-run at any point. */
async function provision(target: ProvisionTarget): Promise<void> {
  let sandboxId = target.sandboxId
  let previewUrl: string | null = null

  if (sandboxId && !(await getInstance(sandboxId))) sandboxId = null // deleted outside the app

  if (!sandboxId) {
    const instance = await createInstance({
      name: `siteformer-${target.projectId.slice(0, 8)}`,
      previewPort: previewPort(),
      metadata: { project_id: target.projectId, user_id: target.userId },
    })
    sandboxId = instance.id
    previewUrl = instance.public_ports?.find((p) => p.port === previewPort())?.url ?? null
    // Save the id before anything else, so a later failure can still reuse or clean it up.
    await target.save({ sandbox_id: sandboxId, preview_url: previewUrl })
  }

  const setup = await exec(sandboxId, setupScript(), 300_000)
  if (setup.exitCode !== 0 || !setup.stdout.includes('setup-ok')) {
    console.error('[sandbox] setup failed', setup.exitCode, setup.stderr.slice(-800))
    throw new SandboxError(STEP_ERRORS[setup.exitCode] ?? 'The sandbox setup failed.')
  }

  await waitForPreview(sandboxId, 120_000)
  previewUrl ??= await ensurePublicUrl(sandboxId, previewPort())
  await target.save({ preview_url: previewUrl, status: 'ready', error: null })
}

/** Wakes a ready sandbox and makes sure its dev server is up (e.g. after a sandbox restart). */
async function resume(target: ProvisionTarget): Promise<void> {
  if (!target.sandboxId || !(await getInstance(target.sandboxId))) {
    // The sandbox is gone: rebuild it from the starter.
    await target.save({ sandbox_id: null, preview_url: null, status: 'provisioning', error: null })
    return provision({ ...target, sandboxId: null })
  }
  const start = `cd ${shellQuote(SITE_DIR)} && (pgrep -f "[v]ite dev" >/dev/null 2>&1 || (PATH="$HOME/.bun/bin:$PATH" nohup bun run dev >/tmp/dev.log 2>&1 &)) && echo ok`
  await exec(target.sandboxId, start, 60_000)
  await waitForPreview(target.sandboxId, 90_000)
}

// ---------------------------------------------------------------------------------------------
// One job per project at a time. Calls while a job runs share it.
// ---------------------------------------------------------------------------------------------

const jobs = new Map<string, Promise<void>>()

function run(target: ProvisionTarget, work: (t: ProvisionTarget) => Promise<void>): Promise<void> {
  const running = jobs.get(target.projectId)
  if (running) return running
  const job = work(target)
    .catch(async (error: unknown) => {
      const message =
        error instanceof SandboxError ? error.message : 'The sandbox setup failed. Try again.'
      console.error(`[sandbox ${target.projectId.slice(0, 8)}]`, error)
      await target.save({ status: 'failed', error: message }).catch(() => undefined)
      throw error
    })
    .finally(() => jobs.delete(target.projectId))
  jobs.set(target.projectId, job)
  return job
}

/** Creates and sets up the sandbox (or resumes an interrupted setup). */
export const ensureProvisioned = (target: ProvisionTarget) => run(target, provision)

/** Brings an already-ready sandbox back up (wake + dev server). */
export const ensureRunning = (target: ProvisionTarget) => run(target, resume)

export const isBusy = (projectId: string) => jobs.has(projectId)
