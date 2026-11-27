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
  type ContentPart,
  type ModelMessage,
  type StreamChunk,
} from '@tanstack/ai'
import {
  clearToolResults,
  composeStrategies,
  conversationSummarizer,
  summarizeOldest,
  withCompaction,
  type Summarizer,
} from '@tanstack/ai-compaction'
import { memoryMiddleware } from '@tanstack/ai-memory'
import { createOpenRouterText } from '@tanstack/ai-openrouter'
import { isTerminalRunStatus, withPersistence } from '@tanstack/ai-persistence'
import { uploadSource } from '~/features/agent/lib/upload-ref'
import type { ProjectMode } from '~/features/projects/lib/constants'
import { AppError } from '../app-error'
import { errorFields, log as logger, preview } from '../log.server'
import { serverEnv } from '../env.server'
import { getProject, provisionTarget } from '../projects.server'
import { ensureProvisioned, isBusy } from '../sandbox/provision.server'
import { supabaseAdmin } from '../supabase-admin.server'
import { chargeTokens, requireCredits } from '../billing/credits.server'
import { suggestNextSteps } from '../ai/suggestions.server'
import { commitAll, ensureRepo, filesChanged } from './checkpoints.server'
import { supabaseMemory } from './memory.server'
import {
  attachmentsMiddleware,
  creditsMiddleware,
  loggingMiddleware,
  progressSaverMiddleware,
  stripAttachments,
  visionMiddleware,
} from './middleware.server'
import { pruneProjectScreenshots } from './screenshots.server'
import { optimizeImage } from './tools/browser.server'
import {
  attachUploads,
  copyUploadsIntoProject,
  downloadUpload,
  projectUploads,
  type UploadRow,
} from './uploads.server'
import { getRunRow, persistence, runStore, type AgentRunRow } from './persistence.server'
import { CHAT_MODE_PROMPT, runContext, SYSTEM_PROMPT } from './prompt.server'
import {
  capText,
  PREVIEW_HOLD_FILE,
  projectSession,
  sh,
  type SandboxSession,
} from './sandbox-session.server'
import { agentTools } from './tools/index.server'
import { restartDevServer } from './tools/shell.server'

const RUN_ID = /^[A-Za-z0-9_-]{8,100}$/
/** Chat mode: attached text files are given to the model inline, up to this many characters. */
const CHAT_DOCUMENT_MAX = 20_000
const SANDBOX_POLL_MS = 3000
/** A queued run gives up waiting for its sandbox after a day (only if nobody fixes the setup). */
const MAX_QUEUE_WAIT_MS = 24 * 60 * 60 * 1000

export const newRunId = () => `run_${crypto.randomUUID().replace(/-/g, '')}`
export const isValidRunId = (id: string) => RUN_ID.test(id)

type ActiveRun = { controller: AbortController; done: Promise<void> }
/** Runs driven by this process, by run id. */
const active = new Map<string, ActiveRun>()

/**
 * Run leases (see migration 20261126000010): this process holds a renewed lease on each run it
 * drives; another process only takes a run over once its lease expired.
 */
const WORKER = `${process.env.RAILWAY_REPLICA_ID ?? 'local'}:${crypto.randomUUID()}`
const LEASE_MS = 40_000
const RENEW_MS = 10_000
const leaseUntil = () => new Date(Date.now() + LEASE_MS).toISOString()

/** Atomically takes (or keeps) the lease on a run. False if another live process holds it. */
async function claimLease(runId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from('agent_runs')
    .update({ lease_owner: WORKER, lease_until: leaseUntil() })
    .eq('id', runId)
    .in('status', ['queued', 'running'])
    .or(`lease_owner.eq.${WORKER},lease_until.is.null,lease_until.lt.${new Date().toISOString()}`)
    .select('id')
  if (error) throw error
  return (data ?? []).length > 0
}

/**
 * Renews the lease. Returns whether it is still held and whether a stop was requested (Stop
 * pressed on a request that another process served).
 */
async function renewLease(runId: string): Promise<{ held: boolean; cancel: boolean }> {
  const { data, error } = await supabaseAdmin()
    .from('agent_runs')
    .update({ lease_until: leaseUntil() })
    .eq('id', runId)
    .eq('lease_owner', WORKER)
    .select('cancel_requested')
    .returns<Array<{ cancel_requested: boolean | null }>>()
  if (error) return { held: true, cancel: false } // a transient error is not a lost lease
  return { held: (data ?? []).length > 0, cancel: data?.[0]?.cancel_requested === true }
}

async function releaseLease(runId: string) {
  await supabaseAdmin()
    .from('agent_runs')
    .update({ lease_owner: null, lease_until: null })
    .eq('id', runId)
    .eq('lease_owner', WORKER)
}

// On shutdown (deploy), hand runs over at once instead of waiting for leases to expire.
process.once('SIGTERM', () => {
  for (const runId of active.keys()) void releaseLease(runId)
})

const now = () => Date.now()
const custom = (name: string, value: Record<string, unknown>): StreamChunk =>
  ({ type: 'CUSTOM', name, value, timestamp: now() }) as StreamChunk

async function updateRun(runId: string, patch: Partial<AgentRunRow>) {
  const { error } = await supabaseAdmin().from('agent_runs').update(patch).eq('id', runId)
  if (error) throw new Error(`Could not update run ${runId}: ${error.message}`)
}

async function appendUserMessage(projectId: string, prompt: string, attachments: Array<UploadRow>) {
  const messages = await persistence.stores.messages.loadThread(projectId)
  // Attachments stay references ("sf-upload:<id>"): the transcript never holds file bytes.
  const content: ModelMessage['content'] = attachments.length
    ? [
        { type: 'text', content: prompt },
        ...attachments.map(
          (a) =>
            ({
              type: a.kind,
              source: uploadSource(a.id, a.mime),
              metadata: { name: a.name },
            }) as ContentPart,
        ),
      ]
    : prompt
  await persistence.stores.messages.saveThread(projectId, [...messages, { role: 'user', content }])
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
  /** Validated uploads (see resolveUploads). */
  attachments?: Array<UploadRow>
  /** Chat runs only read the project. Default: build. */
  mode?: ProjectMode
}): Promise<{ runId: string }> {
  const attachments = input.attachments ?? []
  const { runId, projectId, userId } = input
  const prompt = input.prompt.trim()
  if (!isValidRunId(runId)) throw new AppError('Invalid run id.')

  const existing = await getRunRow(runId)
  if (!existing) await requireCredits(userId)
  if (existing) {
    if (existing.user_id !== userId || existing.project_id !== projectId) {
      throw new AppError('Invalid run id.')
    }
    return { runId } // retried request: already queued
  }

  const { error } = await supabaseAdmin()
    .from('agent_runs')
    .insert({
      id: runId,
      project_id: projectId,
      user_id: userId,
      prompt,
      status: 'queued',
      mode: input.mode ?? 'build',
      // Claimed at birth: no other process may recover it while this one starts driving it.
      lease_owner: WORKER,
      lease_until: leaseUntil(),
    })
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
    if (attachments.length) await attachUploads(runId, attachments)
    await appendUserMessage(projectId, prompt, attachments)
  } catch (err) {
    await supabaseAdmin().from('agent_runs').delete().eq('id', runId)
    throw err
  }
  // Joiners (the sender's tab, other tabs) attach to the log immediately.
  await memoryStream({ runId }).append([custom('run.queued', { runId })])
  logger.info('Agent run queued', {
    event: 'agent.queued',
    runId,
    projectId,
    userId,
    prompt: preview(prompt),
  })
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
      logger.info('Agent run waiting for sandbox', {
        event: 'agent.waiting',
        runId: row.id,
        projectId: row.project_id,
        reason: state,
      })
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

function agentStream(
  row: AgentRunRow,
  session: SandboxSession,
  context: string,
  resumed: boolean,
  controller: AbortController,
  runLog: ReturnType<typeof logger.with>,
  onOutOfCredits: () => void,
) {
  const env = serverEnv()
  const adapter = createOpenRouterText(
    env.AGENT_MODEL as Parameters<typeof createOpenRouterText>[0],
    env.OPENROUTER_API_KEY,
  )
  const systemPrompts = [SYSTEM_PROMPT, context]
  if (row.mode === 'chat') systemPrompts.push(CHAT_MODE_PROMPT)
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
    tools: agentTools(session, row.mode),
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
            summarize: summarizeWithoutMedia(adapter),
            keepRecentTokens: Math.floor(env.AGENT_CONTEXT_TOKENS / 3),
          }),
        ),
        continueOnError: true,
      }),
      attachmentsMiddleware(session),
      visionMiddleware(session),
      progressSaverMiddleware(row.project_id),
      loggingMiddleware(runLog),
      creditsMiddleware(session, onOutOfCredits),
    ],
  })
}

/**
 * Copies this run's attachments into the project and loads the project's upload index (used to
 * describe "sf-upload:" references) plus this run's images (shown to the model during the run).
 */
async function prepareAttachments(session: SandboxSession, row: AgentRunRow) {
  let uploads = await projectUploads(row.project_id)
  const mine = [...uploads.values()]
    .filter((u) => u.run_id === row.id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
  if (mine.length) {
    // Build: files become part of the site. Chat: the project must not change, so the model gets
    // them straight from storage (images shown, text inline). Sketches (the preview with the
    // user's drawing) are only context and never go into the site.
    const assets = mine.filter((u) => u.purpose !== 'sketch')
    const sketches = mine.filter((u) => u.purpose === 'sketch')
    const files = [
      ...(row.mode === 'build'
        ? await copyUploadsIntoProject(session, assets, (bytes, upload) =>
            optimizeImage(session, bytes, upload.mime),
          )
        : assets),
      ...sketches,
    ]
    if (row.mode === 'build') uploads = await projectUploads(row.project_id)
    for (const upload of files) {
      if (upload.kind === 'document') {
        if (row.mode === 'chat') {
          const text = (await downloadUpload(upload)).toString('utf8')
          session.attachedTexts.set(upload.id, capText(text, CHAT_DOCUMENT_MAX))
        }
        continue
      }
      if (upload.mime === 'image/svg+xml') continue
      const bytes = await downloadUpload(upload)
      if (bytes.byteLength <= 5_000_000) {
        session.attachedImages.set(upload.id, {
          mime: upload.mime,
          base64: bytes.toString('base64'),
        })
      }
    }
    logger.info('Attachments prepared', {
      event: 'agent.attachments',
      runId: row.id,
      projectId: row.project_id,
      mode: row.mode,
      files: files.map((u) => u.project_path ?? u.name),
    })
  }
  session.uploads = new Map(
    [...uploads].map(([id, u]) => [
      id,
      {
        name: u.name,
        kind: u.kind,
        mime: u.mime,
        project_path: u.project_path,
        purpose: u.purpose,
      },
    ]),
  )
}

/**
 * Compaction summaries are text-only: attachment references become plain notes first. (These
 * rare summary calls are not charged as credits.)
 */
function summarizeWithoutMedia(
  adapter: Parameters<typeof conversationSummarizer>[0]['adapter'],
): Summarizer {
  const summarize = conversationSummarizer({ adapter })
  return (messages, input) =>
    summarize(
      stripAttachments(messages, () => '[attachment]').map((m) =>
        Array.isArray(m.content)
          ? { ...m, content: m.content.filter((p) => p.type === 'text') }
          : m,
      ),
      input,
    )
}

/** Drives one run to completion in this process. Safe to call twice (second call is a no-op). */
function drive(runId: string, { resumed = false } = {}): Promise<void> {
  const existing = active.get(runId)
  if (existing) return existing.done
  const controller = new AbortController()
  const done = (async () => {
    if (!(await claimLease(runId))) return // another live process is driving it
    const renew = setInterval(() => {
      void renewLease(runId).then(({ held, cancel }) => {
        if (cancel) controller.abort()
        if (held) return
        // Only after this process stalled for longer than the lease. Not aborted here: an abort
        // would mark the run stopped while the other process is finishing it.
        logger.warn('Agent run lease lost', { event: 'agent.lease_lost', runId })
      })
    }, RENEW_MS)
    try {
      await driveInner(runId, controller, resumed)
    } finally {
      clearInterval(renew)
      await releaseLease(runId).catch(() => undefined)
    }
  })()
    // Callers fire and forget: a failure here (e.g. the database is briefly unreachable) must be
    // logged, never become an unhandled rejection. The run is retried by recovery.
    .catch((error: unknown) =>
      logger.error('Driving agent run failed', {
        event: 'agent.drive_failed',
        runId,
        ...errorFields(error),
      }),
    )
    .finally(() => active.delete(runId))
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
  const runLog = logger.with({ runId, projectId: row.project_id })
  const startedAt = now()
  let noCredits = false
  const projectId = row.project_id
  try {
    const project = await waitForSandbox(row, log, controller.signal)
    session = projectSession(
      { ...project, sandbox_id: project.sandbox_id! },
      row.id,
      controller.signal,
    )
    // The preview shows the result when the run is done, never half-written files.
    session.holdPreview = row.mode === 'build'
    runLog.info(resumed ? 'Agent run resumed after restart' : 'Agent run started', {
      event: resumed ? 'agent.resumed' : 'agent.started',
      sandboxId: project.sandbox_id,
      model: serverEnv().AGENT_MODEL,
    })

    await updateRun(runId, {
      status: 'running',
      started_at: row.started_at ?? new Date().toISOString(),
    })
    if (resumed) await repairInterruptedTranscript(row.project_id)

    await ensureRepo(session)
    await restartDevServer(session, { force: false })
    await prepareAttachments(session, row)
    // Chat runs change nothing, so they get no checkpoints (and no Undo).
    if (row.mode === 'build' && !row.checkpoint_before) {
      const before = await commitAll(session, `Before: ${row.prompt}`)
      await updateRun(runId, { checkpoint_before: before })
      row = { ...row, checkpoint_before: before }
    }
    const context = await runContext(session)

    const outOfCredits = () => {
      noCredits = true
      runLog.info('Agent run stopped: out of credits', { event: 'agent.out_of_credits' })
      void requestRunCancel(runStore, runId).finally(() => controller.abort())
    }
    for await (const chunk of agentStream(
      row,
      session,
      context,
      resumed,
      controller,
      runLog,
      outOfCredits,
    )) {
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
    if (stopped && !noCredits)
      runLog.info('Agent run stopped by the user', { event: 'agent.stopped' })
    else if (error instanceof AppError)
      runLog.warn('Agent run ended', { event: 'agent.ended', reason: error.message })
    else runLog.error('Agent run crashed', { event: 'agent.crashed', ...errorFields(error) })
    await log
      .append([
        stopped
          ? custom('run.stopped', {})
          : ({ type: 'RUN_ERROR', message, code: 'agent_error', timestamp: now() } as StreamChunk),
      ])
      .catch(() => undefined)
  } finally {
    await finalize(runId, session, row)
      .then(async () => {
        if (!noCredits) return
        // The last credit may run out on the final step, when the work is already done.
        const cut = (await getRunRow(runId))?.status !== 'completed'
        await appendAssistantNote(
          projectId,
          cut
            ? '⚠ You ran out of credits, so the agent stopped here. Get more credits to continue.'
            : '⚠ That used your last credits. Get more credits to keep building.',
        )
      })
      .then(async () => {
        const done = await getRunRow(runId)
        if (done?.status === 'completed' && !noCredits) void offerNextSteps(done)
        const usage = (done?.record as { usage?: Record<string, unknown> } | undefined)?.usage
        const details = usage?.promptTokensDetails as { cachedTokens?: number } | undefined
        runLog.info('Agent run finished', {
          event: 'agent.finished',
          status: done?.status,
          filesChanged: done?.files_changed,
          ms: now() - startedAt,
          costUsd: usage?.cost,
          promptTokens: usage?.promptTokens,
          cachedTokens: details?.cachedTokens,
          completionTokens: usage?.completionTokens,
          checkpoint: done?.checkpoint_after?.slice(0, 7),
        })
      })
      .catch((err) =>
        runLog.error('Agent run finalize failed', {
          event: 'agent.finalize_failed',
          ...errorFields(err),
        }),
      )
    await log.close().catch(() => undefined)
  }
}

/** Tokens charged for the next-step suggestions (a small model; about a tenth of a credit). */
const SUGGESTION_TOKENS = 1_000

/** Saves one-click next steps for a finished reply (best effort, in the background). */
async function offerNextSteps(run: AgentRunRow) {
  try {
    const messages = await persistence.stores.messages.loadThread(run.project_id)
    const reply = [...messages].reverse().find((m) => m.role === 'assistant' && m.content)
    const text = typeof reply?.content === 'string' ? reply.content : ''
    if (!text.trim()) return
    const suggestions = await suggestNextSteps(run.prompt, text, run.mode)
    if (!suggestions.length) return
    await updateRun(run.id, { suggestions })
    await chargeTokens(run.id, SUGGESTION_TOKENS).catch(() => undefined)
  } catch (error) {
    logger.warn('Saving reply suggestions failed', {
      event: 'suggestions.save_failed',
      runId: run.id,
      ...errorFields(error),
    })
  }
}

/** Checkpoint after the run, and make sure the run ends in a terminal status. */
async function finalize(runId: string, session: SandboxSession | null, row: AgentRunRow) {
  const patch: Partial<AgentRunRow> = {}
  const afterSession = session && {
    ...session,
    holdPreview: false,
    signal: new AbortController().signal,
  }
  if (afterSession && row.checkpoint_before) {
    // Commit even after a stop/failure so the user can always restore around this run.
    const after = await commitAll(afterSession, row.prompt)
    patch.checkpoint_after = after
    patch.files_changed = await filesChanged(afterSession, row.checkpoint_before, after)
  }
  // The preview may live-update again (the page reloads to show the result).
  if (afterSession && session?.holdPreview) {
    await sh(afterSession, `rm -f ${PREVIEW_HOLD_FILE}`, { timeoutSeconds: 15 }).catch(
      () => undefined,
    )
  }
  const current = await getRunRow(runId)
  if (current && (current.status === 'queued' || current.status === 'running')) {
    patch.status = current.cancel_requested ? 'aborted' : 'failed'
  }
  if (current && !current.finished_at) patch.finished_at = new Date().toISOString()
  if (Object.keys(patch).length) await updateRun(runId, patch)
  void pruneProjectScreenshots(row.project_id)
}

/** Stops a run (the owner pressed Stop). Changes made so far are checkpointed. */
export async function cancelRun(runId: string, userId: string): Promise<void> {
  const row = await getRunRow(runId)
  if (!row || row.user_id !== userId) throw new AppError('Run not found.', 'not_found')
  if (row.status !== 'queued' && row.status !== 'running') return
  logger.info('Agent run cancel requested', {
    event: 'agent.cancel',
    runId,
    projectId: row.project_id,
  })
  await requestRunCancel(runStore, runId)
  const run = active.get(runId)
  if (run) {
    run.controller.abort()
    return
  }
  // Driven by another live process: it sees the request within seconds (lease renewal).
  if (row.lease_until && Date.parse(row.lease_until) > Date.now()) return
  // Not driven by anyone (e.g. right after a restart): finish it here.
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
  // Only runs nobody holds: their process died (or never claimed them).
  let query = supabaseAdmin()
    .from('agent_runs')
    .select('id, status')
    .in('status', ['queued', 'running'])
    .or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`)
  if (projectId) query = query.eq('project_id', projectId)
  const { data, error } = await query.returns<Array<{ id: string; status: string }>>()
  if (error) throw error
  let resumed = 0
  for (const run of data ?? []) {
    if (active.has(run.id)) continue
    resumed += 1
    logger.info('Resuming unfinished agent run', {
      event: 'agent.recover',
      runId: run.id,
      status: run.status,
    })
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
export async function appendAssistantNote(
  projectId: string,
  note: string,
  { unlessRepeated = false }: { unlessRepeated?: boolean } = {},
) {
  const messages = await persistence.stores.messages.loadThread(projectId)
  const last = messages.at(-1)
  // Many small edits in a row (visual editor) leave one note, not one per click.
  if (unlessRepeated && last?.role === 'assistant' && last.content === note) return
  await persistence.stores.messages.saveThread(projectId, [
    ...messages,
    { role: 'assistant', content: note },
  ])
}
