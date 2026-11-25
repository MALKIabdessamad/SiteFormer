/**
 * The coding agent's run driver.
 *
 * A run is driven by THIS server process, never by a browser connection: closing the tab or
 * refreshing never stops it. Every streamed chunk is appended to the run's delivery log
 * (memoryStream); any tab can replay + follow the log live (GET /api/agent?runId=…&offset=…).
 * The transcript is saved after every tool round, so a server restart (deploy) loses at most the
 * step in progress: on boot, interrupted runs are resumed from the saved transcript.
 *
 * Lifecycle: queued (waits for the sandbox) → running → completed | failed | aborted.
 */
import {
  chat,
  maxIterations,
  memoryStream,
  requestRunCancel,
  type ModelMessage,
  type StreamChunk,
} from '@tanstack/ai'
import {
  clearToolResults,
  composeStrategies,
  conversationSummarizer,
  summarizeOldest,
  withCompaction,
} from '@tanstack/ai-compaction'
import { memoryMiddleware } from '@tanstack/ai-memory'
import { createOpenRouterText } from '@tanstack/ai-openrouter'
import { isTerminalRunStatus, withPersistence } from '@tanstack/ai-persistence'
import { AppError } from '../app-error'
import { serverEnv } from '../env.server'
import { getProject, provisionTarget, type ProjectRow } from '../projects.server'
import { ensureProvisioned, isBusy } from '../sandbox/provision.server'
import { supabaseAdmin } from '../supabase-admin.server'
import { commitAll, ensureRepo, filesChanged } from './checkpoints.server'
import { supabaseMemory } from './memory.server'
import { progressSaverMiddleware, visionMiddleware } from './middleware.server'
import { getRunRow, persistence, runStore, type AgentRunRow } from './persistence.server'
import { runContext, SYSTEM_PROMPT } from './prompt.server'
import type { SandboxSession } from './sandbox-session.server'
import { agentTools } from './tools/index.server'
import { restartDevServer } from './tools/shell.server'

const RUN_ID = /^[A-Za-z0-9_-]{8,100}$/
const SANDBOX_POLL_MS = 3000
/** A queued run gives up waiting for its sandbox after a day (only if nobody fixes the setup). */
const MAX_QUEUE_WAIT_MS = 24 * 60 * 60 * 1000

export const newRunId = () => `run_${crypto.randomUUID().replace(/-/g, '')}`
export const isValidRunId = (id: string) => RUN_ID.test(id)

type ActiveRun = { controller: AbortController; done: Promise<void> }
/** Runs driven by this process, by run id. */
const active = new Map<string, ActiveRun>()

const now = () => Date.now()
const custom = (name: string, value: Record<string, unknown>): StreamChunk =>
  ({ type: 'CUSTOM', name, value, timestamp: now() }) as StreamChunk

async function updateRun(runId: string, patch: Partial<AgentRunRow>) {
  const { error } = await supabaseAdmin().from('agent_runs').update(patch).eq('id', runId)
  if (error) throw new Error(`Could not update run ${runId}: ${error.message}`)
}

async function appendUserMessage(projectId: string, prompt: string) {
  const messages = await persistence.stores.messages.loadThread(projectId)
  await persistence.stores.messages.saveThread(projectId, [
    ...messages,
    { role: 'user', content: prompt },
  ])
}

/**
 * Queues a run for a user message and starts driving it. Idempotent for the same run id.
 * Throws AppError('…', 'limit') if another run of the project is still active.
 */
export async function enqueueRun(input: {
  runId: string
  projectId: string
  userId: string
  prompt: string
}): Promise<{ runId: string }> {
  const { runId, projectId, userId } = input
  const prompt = input.prompt.trim()
  if (!isValidRunId(runId)) throw new AppError('Invalid run id.')

  const existing = await getRunRow(runId)
  if (existing) {
    if (existing.user_id !== userId || existing.project_id !== projectId) {
      throw new AppError('Invalid run id.')
    }
    return { runId } // retried request: already queued
  }

  const { error } = await supabaseAdmin()
    .from('agent_runs')
    .insert({ id: runId, project_id: projectId, user_id: userId, prompt, status: 'queued' })
  if (error) {
    if (error.code === '23505') {
      throw new AppError(
        'The agent is still working on your last message. Stop it or wait.',
        'limit',
      )
    }
    throw error
  }
  try {
    await appendUserMessage(projectId, prompt)
  } catch (err) {
    await supabaseAdmin().from('agent_runs').delete().eq('id', runId)
    throw err
  }
  // Joiners (the sender's tab, other tabs) attach to the log immediately.
  await memoryStream({ runId }).append([custom('run.queued', { runId })])
  void drive(runId)
  return { runId }
}

/** Waits until the project's sandbox is ready, nudging provisioning when nothing drives it. */
async function waitForSandbox(
  row: AgentRunRow,
  log: ReturnType<typeof memoryStream>,
  signal: AbortSignal,
) {
  const started = now()
  let announced = ''
  for (;;) {
    if (signal.aborted) throw new AppError('Stopped.', 'invalid')
    const project = await getProject(row.project_id)
    if (!project) throw new AppError('The project was deleted.', 'not_found')
    if (project.status === 'ready' && project.sandbox_id) return project
    const state = project.status === 'failed' ? 'sandbox_failed' : 'sandbox_starting'
    if (state !== announced) {
      announced = state
      await log.append([custom('run.waiting', { reason: state })])
    }
    // After a restart nothing drives an unfinished setup: resume it (failed setups wait for Retry).
    if (project.status === 'provisioning' && !isBusy(project.id)) {
      void ensureProvisioned(provisionTarget(project)).catch(() => undefined)
    }
    if (now() - started > MAX_QUEUE_WAIT_MS)
      throw new AppError('The sandbox was never ready.', 'unavailable')
    await new Promise((resolve) => setTimeout(resolve, SANDBOX_POLL_MS))
  }
}

/**
 * A run interrupted mid-tool (server restart) can end with tool calls that have no results, which
 * models reject. Close them with an explanatory result so the model can redo what it needs.
 */
async function repairInterruptedTranscript(projectId: string) {
  const messages = await persistence.stores.messages.loadThread(projectId)
  const answered = new Set(messages.filter((m) => m.role === 'tool').map((m) => m.toolCallId))
  const repaired: Array<ModelMessage> = []
  for (const message of messages) {
    repaired.push(message)
    if (message.role !== 'assistant' || !message.toolCalls?.length) continue
    for (const call of message.toolCalls) {
      if (answered.has(call.id)) continue
      repaired.push({
        role: 'tool',
        toolCallId: call.id,
        content: JSON.stringify({
          error: 'Interrupted by a server restart before finishing. Re-run it if still needed.',
        }),
      })
    }
  }
  if (repaired.length !== messages.length) {
    await persistence.stores.messages.saveThread(projectId, repaired)
  }
}

function sessionFor(row: AgentRunRow, project: ProjectRow, signal: AbortSignal): SandboxSession {
  return {
    sandboxId: project.sandbox_id!,
    projectId: project.id,
    userId: row.user_id,
    runId: row.id,
    signal,
    previewPort: serverEnv().STARTER_PORT,
    pendingImages: [],
    screenshotCount: 0,
  }
}

function agentStream(
  row: AgentRunRow,
  session: SandboxSession,
  context: string,
  resumed: boolean,
  controller: AbortController,
) {
  const env = serverEnv()
  const adapter = createOpenRouterText(
    env.AGENT_MODEL as Parameters<typeof createOpenRouterText>[0],
    env.OPENROUTER_API_KEY,
  )
  const systemPrompts = [SYSTEM_PROMPT, context]
  if (resumed) {
    systemPrompts.push(
      'Note: your previous run on this request was interrupted by a server restart. Check the ' +
        'project state (it may be partly done) and continue the task from where it stopped.',
    )
  }
  return chat({
    adapter,
    threadId: row.project_id,
    runId: row.id,
    // Server-authoritative: the transcript (with the user's message) is loaded from storage.
    messages: [],
    systemPrompts,
    tools: agentTools(session),
    reasoning: env.AGENT_REASONING,
    agentLoopStrategy: maxIterations(env.AGENT_MAX_STEPS),
    abortController: controller,
    middleware: [
      withPersistence(persistence),
      memoryMiddleware({
        adapter: supabaseMemory(),
        scope: { threadId: row.project_id, userId: row.user_id },
      }),
      withCompaction({
        maxTokens: env.AGENT_CONTEXT_TOKENS,
        // Cheapest first: stub old tool output; only then summarize the oldest turns.
        strategy: composeStrategies(
          clearToolResults({ keepRecentToolResults: 6 }),
          summarizeOldest({
            summarize: conversationSummarizer({ adapter }),
            keepRecentTokens: Math.floor(env.AGENT_CONTEXT_TOKENS / 3),
          }),
        ),
        continueOnError: true,
      }),
      visionMiddleware(session),
      progressSaverMiddleware(row.project_id),
    ],
  })
}

/** Drives one run to completion in this process. Safe to call twice (second call is a no-op). */
function drive(runId: string, { resumed = false } = {}): Promise<void> {
  const existing = active.get(runId)
  if (existing) return existing.done
  const controller = new AbortController()
  const done = driveInner(runId, controller, resumed).finally(() => active.delete(runId))
  active.set(runId, { controller, done })
  return done
}

async function driveInner(runId: string, controller: AbortController, resumed: boolean) {
  const log = memoryStream({ runId })
  let session: SandboxSession | null = null
  let row = await getRunRow(runId)
  if (!row || isTerminalRunStatus(row.status === 'queued' ? 'running' : row.status)) {
    await log.close()
    return
  }
  try {
    const project = await waitForSandbox(row, log, controller.signal)
    session = sessionFor(row, project, controller.signal)

    await updateRun(runId, {
      status: 'running',
      started_at: row.started_at ?? new Date().toISOString(),
    })
    if (resumed) await repairInterruptedTranscript(row.project_id)

    await ensureRepo(session)
    await restartDevServer(session, { force: false })
    if (!row.checkpoint_before) {
      const before = await commitAll(session, `Before: ${row.prompt}`)
      await updateRun(runId, { checkpoint_before: before })
      row = { ...row, checkpoint_before: before }
    }
    const context = await runContext(session)

    for await (const chunk of agentStream(row, session, context, resumed, controller)) {
      await log.append([chunk])
    }
  } catch (error) {
    const stopped = controller.signal.aborted
    const message =
      error instanceof AppError
        ? error.message
        : stopped
          ? 'Stopped.'
          : 'The agent hit an error. Try again.'
    if (!(error instanceof AppError) && !stopped) console.error(`[agent ${runId}]`, error)
    await log
      .append([
        stopped
          ? custom('run.stopped', {})
          : ({ type: 'RUN_ERROR', message, code: 'agent_error', timestamp: now() } as StreamChunk),
      ])
      .catch(() => undefined)
  } finally {
    await finalize(runId, session, row).catch((err) =>
      console.error(`[agent ${runId}] finalize`, err),
    )
    await log.close().catch(() => undefined)
  }
}

/** Checkpoint after the run, and make sure the run ends in a terminal status. */
async function finalize(runId: string, session: SandboxSession | null, row: AgentRunRow) {
  const patch: Partial<AgentRunRow> = {}
  if (session && row.checkpoint_before) {
    // Commit even after a stop/failure so the user can always restore around this run.
    const afterSession = { ...session, signal: new AbortController().signal }
    const after = await commitAll(afterSession, row.prompt)
    patch.checkpoint_after = after
    patch.files_changed = await filesChanged(afterSession, row.checkpoint_before, after)
  }
  const current = await getRunRow(runId)
  if (current && (current.status === 'queued' || current.status === 'running')) {
    patch.status = current.cancel_requested ? 'aborted' : 'failed'
  }
  if (current && !current.finished_at) patch.finished_at = new Date().toISOString()
  if (Object.keys(patch).length) await updateRun(runId, patch)
}

/** Stops a run (the owner pressed Stop). Changes made so far are checkpointed. */
export async function cancelRun(runId: string, userId: string): Promise<void> {
  const row = await getRunRow(runId)
  if (!row || row.user_id !== userId) throw new AppError('Run not found.', 'not_found')
  if (row.status !== 'queued' && row.status !== 'running') return
  await requestRunCancel(runStore, runId)
  const run = active.get(runId)
  if (run) {
    run.controller.abort()
    return
  }
  // Not driven by this process (e.g. right after a restart): finish it here.
  await updateRun(runId, {
    status: 'aborted',
    cancel_requested: true,
    finished_at: new Date().toISOString(),
  })
}

/**
 * Resumes runs left queued/running by a previous server process (deploy/crash). Called at boot,
 * and whenever a project is opened (self-healing).
 */
export async function recoverRuns(projectId?: string): Promise<number> {
  let query = supabaseAdmin()
    .from('agent_runs')
    .select('id, status')
    .in('status', ['queued', 'running'])
  if (projectId) query = query.eq('project_id', projectId)
  const { data, error } = await query.returns<Array<{ id: string; status: string }>>()
  if (error) throw error
  let resumed = 0
  for (const run of data ?? []) {
    if (active.has(run.id)) continue
    resumed += 1
    void drive(run.id, { resumed: run.status === 'running' })
  }
  return resumed
}

/** Stops every active run of a project and waits (briefly) for them to wind down. */
export async function stopProjectRuns(projectId: string, userId: string): Promise<void> {
  const { data } = await supabaseAdmin()
    .from('agent_runs')
    .select('id')
    .eq('project_id', projectId)
    .in('status', ['queued', 'running'])
    .returns<Array<{ id: string }>>()
  const waits: Array<Promise<unknown>> = []
  for (const { id } of data ?? []) {
    await cancelRun(id, userId)
    const run = active.get(id)
    if (run) waits.push(run.done)
  }
  await Promise.race([
    Promise.allSettled(waits),
    new Promise((resolve) => setTimeout(resolve, 15_000)),
  ])
}

/** Whether a project has an active (queued/running) run. */
export async function hasActiveRun(projectId: string): Promise<boolean> {
  const { count, error } = await supabaseAdmin()
    .from('agent_runs')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .in('status', ['queued', 'running'])
  if (error) throw error
  return (count ?? 0) > 0
}

/** Adds a short assistant note to the transcript (e.g. after a restore), so the model knows. */
export async function appendAssistantNote(projectId: string, note: string) {
  const messages = await persistence.stores.messages.loadThread(projectId)
  await persistence.stores.messages.saveThread(projectId, [
    ...messages,
    { role: 'assistant', content: note },
  ])
}
