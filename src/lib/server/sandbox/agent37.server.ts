import { serverEnv } from '../env.server'

/**
 * Minimal Agent37 client. The API key never leaves the server.
 *
 * Verified against the live API (Nov 2026):
 * - POST   /v1/instances               → instance, `status: "running"` within ~1s,
 *                                         `public_ports[].url` already assigned
 * - GET    /v1/instances/{id}          → instance (404 `not_found` once deleted)
 * - DELETE /v1/instances/{id}          → `{ id, deleted: true }`
 * - POST   /v1/instances/{id}/public-ports
 * - POST   https://sandbox.agent37.app/v1/instances/{id}/exec  (header `X-Agent37-Key`)
 *          body `{ command }` → `{ exit_code, stdout, stderr, truncated }`.
 *          Wakes a sleeping sandbox by itself; answers 409 while a sleep checkpoint is written.
 */

const API_URL = 'https://api.agent37.com/v1'
const EXEC_URL = 'https://sandbox.agent37.app/v1'

export class SandboxError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'SandboxError'
  }
}

export type Instance = {
  id: string
  status: 'running' | 'sleeping' | 'stopped' | string
  public_ports?: Array<{ port: number; url: string }>
  metadata?: Record<string, string>
}

export type ExecResult = { exitCode: number; stdout: string; stderr: string; truncated: boolean }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** API calls: retry rate limits, checkpointing (409) and transient upstream errors. */
const RETRYABLE = new Set([409, 429, 502, 503, 504])
/**
 * Commands: only retry rejections that happen BEFORE the command runs (409 while the sandbox
 * checkpoints, 429). A 502/504 can arrive while the command is still running, and re-sending it
 * would run it twice in parallel.
 */
const EXEC_RETRYABLE = new Set([409, 429])

async function request(
  url: string,
  init: RequestInit & {
    timeoutMs?: number
    retries?: number
    retryOn?: Set<number>
    /** Retry when no response arrives at all. Off for commands (they may still be running). */
    retryNetworkErrors?: boolean
    /** Caller cancellation (e.g. the user pressed Stop). Never retried. */
    signal?: AbortSignal
  } = {},
): Promise<Response> {
  const {
    timeoutMs = 30_000,
    retries = 0,
    retryOn = RETRYABLE,
    retryNetworkErrors = true,
    signal,
    ...rest
  } = init
  for (let attempt = 0; ; attempt++) {
    let response: Response | undefined
    try {
      const timeout = AbortSignal.timeout(timeoutMs)
      response = await fetch(url, {
        ...rest,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
    } catch (error) {
      if (signal?.aborted) throw new SandboxError('Cancelled.')
      if (attempt >= retries || !retryNetworkErrors) {
        const reason =
          error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : 'failed'
        throw new SandboxError(`Agent37 request ${reason}.`)
      }
    }
    if (response && (!retryOn.has(response.status) || attempt >= retries)) return response
    if (signal?.aborted) throw new SandboxError('Cancelled.')
    await sleep(Math.min(1000 * 2 ** attempt, 8000))
  }
}

function apiHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${serverEnv().AGENT37_API_KEY}`,
    'Content-Type': 'application/json',
  }
}

/** Fails with a short, key-free message (response bodies can echo request details). */
async function ensureOk(response: Response, what: string): Promise<Response> {
  if (response.ok) return response
  const body = (await response.text().catch(() => '')).slice(0, 160)
  throw new SandboxError(`Agent37 ${what} failed (${response.status}): ${body}`, response.status)
}

export async function createInstance(input: {
  name: string
  previewPort: number
  metadata: Record<string, string>
}): Promise<Instance> {
  const { AGENT37_TEMPLATE } = serverEnv()
  // Not retried: a retry after a lost response could create a second sandbox.
  const response = await request(`${API_URL}/instances`, {
    method: 'POST',
    headers: apiHeaders(),
    timeoutMs: 60_000,
    body: JSON.stringify({
      template: AGENT37_TEMPLATE,
      name: input.name,
      auto_sleep: true,
      idle_timeout_seconds: 1800,
      public_ports: [{ port: input.previewPort, label: 'Site preview' }],
      metadata: input.metadata,
    }),
  })
  return (await ensureOk(response, 'create sandbox')).json() as Promise<Instance>
}

/** The instance, or `null` if it no longer exists. */
export async function getInstance(id: string): Promise<Instance | null> {
  const response = await request(`${API_URL}/instances/${encodeURIComponent(id)}`, {
    headers: apiHeaders(),
    retries: 2,
  })
  if (response.status === 404) return null
  return (await ensureOk(response, 'get sandbox')).json() as Promise<Instance>
}

/** Deletes a sandbox. Already gone counts as success. */
export async function deleteInstance(id: string): Promise<void> {
  const response = await request(`${API_URL}/instances/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: apiHeaders(),
    retries: 2,
  })
  if (response.status === 404) return
  await ensureOk(response, 'delete sandbox')
}

/** Public URL of `port`, creating the public port if the instance doesn't have one yet. */
export async function ensurePublicUrl(id: string, port: number): Promise<string> {
  const instance = await getInstance(id)
  if (!instance) throw new SandboxError('The sandbox no longer exists.', 404)
  const existing = instance.public_ports?.find((p) => p.port === port)?.url
  if (existing) return existing
  const response = await request(`${API_URL}/instances/${encodeURIComponent(id)}/public-ports`, {
    method: 'POST',
    headers: apiHeaders(),
    retries: 2,
    body: JSON.stringify({ port, label: 'Site preview' }),
  })
  const created = (await (await ensureOk(response, 'open preview port')).json()) as { url: string }
  return created.url
}

/** Runs a shell command in the sandbox (as user `node`, in /home/node). */
export async function exec(
  id: string,
  command: string,
  timeoutMs = 60_000,
  signal?: AbortSignal,
): Promise<ExecResult> {
  const response = await request(`${EXEC_URL}/instances/${encodeURIComponent(id)}/exec`, {
    signal,
    method: 'POST',
    headers: { 'X-Agent37-Key': serverEnv().AGENT37_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ command }),
    timeoutMs,
    retries: 6,
    retryOn: EXEC_RETRYABLE,
    retryNetworkErrors: false,
  })
  const data = (await (await ensureOk(response, 'command')).json()) as {
    exit_code: number
    stdout: string
    stderr: string
    truncated?: boolean
  }
  return {
    exitCode: data.exit_code,
    stdout: data.stdout,
    stderr: data.stderr,
    truncated: Boolean(data.truncated),
  }
}

/** Quotes a value for a POSIX shell. */
export const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`
