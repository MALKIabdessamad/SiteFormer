/**
 * HTTP handlers for /api/agent (the chat connection used by useChat's fetchServerSentEvents).
 * Every request is authenticated (Supabase access token) and ownership-checked; ids from the
 * client are never trusted on their own.
 */
import { errorFields, log } from '../log.server'
import {
  chatParamsFromRequestBody,
  memoryStream,
  resumeServerSentEventsResponse,
  type ModelMessage,
  type UIMessage,
} from '@tanstack/ai'
import { reconstructChat } from '@tanstack/ai-persistence'
import { AppError } from '../app-error'
import { authenticate } from '../auth.server'
import { ConfigError } from '../env.server'
import { ownedProject } from '../projects.server'
import { getRunRow, persistence } from './persistence.server'
import { cancelRun, enqueueRun, isValidRunId, recoverRuns } from './runner.server'

const MAX_PROMPT = 8000
/** A from-start join waits this long for a run's first chunk (queued runs write one at once). */
const JOIN_DEADLINE_MS = 5000

const STATUS: Record<AppError['code'], number> = {
  unauthorized: 401,
  not_found: 404,
  limit: 409,
  invalid: 400,
  unavailable: 503,
}

export function errorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    return Response.json({ error: error.message, code: error.code }, { status: STATUS[error.code] })
  }
  if (error instanceof ConfigError) {
    log.error('Agent API misconfigured', { event: 'api.config_error', error: error.message })
    return Response.json(
      { error: 'The agent is not set up on the server yet.', code: 'unavailable' },
      { status: 503 },
    )
  }
  log.error('Agent API unexpected error', { event: 'api.error', ...errorFields(error) })
  return Response.json(
    { error: 'Something went wrong. Please try again.', code: 'unavailable' },
    { status: 500 },
  )
}

/** Plain text of the newest user message (UIMessage parts or ModelMessage content). */
function lastUserText(messages: Array<UIMessage | ModelMessage>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as UIMessage & ModelMessage
    if (message.role !== 'user') continue
    if (Array.isArray(message.parts)) {
      return message.parts
        .map((part) => (part.type === 'text' ? part.content : ''))
        .join('')
        .trim()
    }
    if (typeof message.content === 'string') return message.content.trim()
    if (Array.isArray(message.content)) {
      return message.content
        .map((part) => (part.type === 'text' ? part.content : ''))
        .join('')
        .trim()
    }
  }
  return ''
}

/** POST /api/agent: queue the user's message as a run and stream the run's log back. */
export async function postMessage(request: Request): Promise<Response> {
  const user = await authenticate(request.headers.get('authorization') ?? undefined)
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new AppError('Invalid request.')
  }
  const params = await chatParamsFromRequestBody(body).catch(() => {
    throw new AppError('Invalid request.')
  })
  const project = await ownedProject(user.id, params.threadId)
  const prompt = lastUserText(params.messages)
  if (!prompt) throw new AppError('Write a message first.')
  if (prompt.length > MAX_PROMPT)
    throw new AppError(`Keep messages under ${MAX_PROMPT} characters.`)
  if (!isValidRunId(params.runId)) throw new AppError('Invalid run id.')

  await enqueueRun({ runId: params.runId, projectId: project.id, userId: user.id, prompt })
  return resumeServerSentEventsResponse({
    adapter: memoryStream(
      { runId: params.runId, offset: '-1' },
      { firstChunkDeadlineMs: JOIN_DEADLINE_MS },
    ),
  })
}

/**
 * GET /api/agent?threadId=<project id>          → stored transcript + the active run (hydrate)
 * GET /api/agent?runId=<run id>&offset=<offset> → replay + follow a run's live log (join/resume)
 */
export async function getAgent(request: Request): Promise<Response> {
  const user = await authenticate(request.headers.get('authorization') ?? undefined)
  const url = new URL(request.url)
  const runId = url.searchParams.get('runId') ?? request.headers.get('x-run-id')
  if (runId) {
    const run = isValidRunId(runId) ? await getRunRow(runId) : null
    if (!run || run.user_id !== user.id) throw new AppError('Run not found.', 'not_found')
    return resumeServerSentEventsResponse({
      adapter: memoryStream(request, { firstChunkDeadlineMs: JOIN_DEADLINE_MS }),
    })
  }
  const threadId = url.searchParams.get('threadId') ?? ''
  const project = await ownedProject(user.id, threadId)
  // Self-healing: resume this project's runs if a restart orphaned them.
  await recoverRuns(project.id)
  return reconstructChat(persistence, request, { authorize: async () => true })
}

/** POST /api/agent?action=cancel  body { runId } */
export async function postCancel(request: Request): Promise<Response> {
  const user = await authenticate(request.headers.get('authorization') ?? undefined)
  const body = (await request.json().catch(() => ({}))) as { runId?: unknown }
  if (typeof body.runId !== 'string' || !isValidRunId(body.runId))
    throw new AppError('Invalid run id.')
  await cancelRun(body.runId, user.id)
  return Response.json({ ok: true })
}

/** POST /api/agent?action=recover  (internal: called by server.ts at boot with a per-process token) */
export async function postRecover(request: Request): Promise<Response> {
  const token = process.env.SITEFORMER_INTERNAL_TOKEN
  if (!token || request.headers.get('x-siteformer-internal') !== token) {
    throw new AppError('Not found.', 'not_found')
  }
  return Response.json({ resumed: await recoverRuns() })
}
