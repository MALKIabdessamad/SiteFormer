/**
 * TanStack AI persistence backed by Supabase (secret key, server only).
 *
 *   messages → agent_threads   one row per project (threadId = project id), full replace
 *   runs     → agent_runs      one row per user message; created by the app (queue), driven here
 *   metadata → agent_metadata  compaction checkpoints
 *
 * Interrupts (human approval of tool calls) are not used, so that store is not implemented.
 */
import {
  defineAIPersistence,
  defineRunStore,
  type ChatTranscriptPersistence,
  type RunRecord,
  type RunStatus,
} from '@tanstack/ai-persistence'
import type { MetadataStore, ModelMessage } from '@tanstack/ai'
import { supabaseAdmin } from '../supabase-admin.server'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** App-level run status: TanStack's statuses plus 'queued' (waiting for the sandbox). */
export type AgentRunStatus = RunStatus | 'queued'

export type AgentRunRow = {
  id: string
  project_id: string
  user_id: string
  prompt: string
  status: AgentRunStatus
  cancel_requested: boolean | null
  checkpoint_before: string | null
  checkpoint_after: string | null
  files_changed: number | null
  /** Upload ids attached to this run's message. */
  attachments: Array<string>
  record: Partial<RunRecord>
  created_at: string
  started_at: string | null
  finished_at: string | null
}

/** RunRecord fields stored as real columns (everything else lives in `record`). */
const COLUMN_FIELDS = new Set([
  'runId',
  'threadId',
  'status',
  'startedAt',
  'finishedAt',
  'cancelRequested',
])

export function toRunRecord(row: AgentRunRow): RunRecord {
  const extras = Object.fromEntries(
    Object.entries(row.record ?? {}).filter(([key]) => !COLUMN_FIELDS.has(key)),
  )
  return {
    ...extras,
    runId: row.id,
    threadId: row.project_id,
    // A queued run is "in flight" from TanStack's point of view: clients can join its log.
    status: row.status === 'queued' ? 'running' : row.status,
    startedAt: Date.parse(row.started_at ?? row.created_at),
    ...(row.finished_at ? { finishedAt: Date.parse(row.finished_at) } : {}),
    ...(row.cancel_requested != null ? { cancelRequested: row.cancel_requested } : {}),
  }
}

async function getRunRow(runId: string): Promise<AgentRunRow | null> {
  const { data, error } = await supabaseAdmin()
    .from('agent_runs')
    .select('*')
    .eq('id', runId)
    .maybeSingle<AgentRunRow>()
  if (error) throw error
  return data
}

const messages = {
  async loadThread(threadId: string): Promise<Array<ModelMessage>> {
    if (!UUID.test(threadId)) return []
    const { data, error } = await supabaseAdmin()
      .from('agent_threads')
      .select('messages')
      .eq('project_id', threadId)
      .maybeSingle<{ messages: Array<ModelMessage> }>()
    if (error) throw error
    return data?.messages ?? []
  },

  /** Full replace (merging by id is withPersistence's job, not the store's). */
  async saveThread(threadId: string, list: Array<ModelMessage>): Promise<void> {
    if (!UUID.test(threadId)) throw new Error(`Invalid thread id: ${threadId}`)
    const { error } = await supabaseAdmin()
      .from('agent_threads')
      .upsert({ project_id: threadId, messages: list }, { onConflict: 'project_id' })
    if (error) throw error
  },
}

const runs = defineRunStore({
  /**
   * Insert-if-absent. Runs are always created by the app first (with project, owner and prompt),
   * so this returns the existing record and marks it running.
   */
  async createOrResume(input) {
    const row = await getRunRow(input.runId)
    if (!row) throw new Error(`Run ${input.runId} was not created by the app`)
    if (row.project_id !== input.threadId)
      throw new Error(`Run ${input.runId} is not on this thread`)
    return toRunRecord(row)
  },

  async update(runId, patch) {
    const row = await getRunRow(runId)
    if (!row) throw new Error(`Unknown run ${runId}`)

    const update: Record<string, unknown> = {}
    if (patch.status !== undefined) update.status = patch.status
    if ('finishedAt' in patch) {
      update.finished_at = patch.finishedAt ? new Date(patch.finishedAt).toISOString() : null
    }
    // `'field' in patch`: an explicit undefined clears the value (TanStack store contract).
    if ('cancelRequested' in patch) update.cancel_requested = patch.cancelRequested ?? null

    const record: Record<string, unknown> = { ...row.record }
    for (const [key, value] of Object.entries(patch)) {
      if (COLUMN_FIELDS.has(key)) continue
      if (value === undefined) delete record[key]
      else record[key] = value
    }
    update.record = record

    const { error } = await supabaseAdmin().from('agent_runs').update(update).eq('id', runId)
    if (error) throw error
  },

  async get(runId) {
    const row = await getRunRow(runId)
    return row ? toRunRecord(row) : null
  },

  /** The run a reloading client should rejoin: queued (waiting for the sandbox) or running. */
  async findActiveRun(threadId) {
    if (!UUID.test(threadId)) return null
    const { data, error } = await supabaseAdmin()
      .from('agent_runs')
      .select('*')
      .eq('project_id', threadId)
      .in('status', ['queued', 'running'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<AgentRunRow>()
    if (error) throw error
    return data ? toRunRecord(data) : null
  },

  async listByThread(threadId) {
    if (!UUID.test(threadId)) return []
    const { data, error } = await supabaseAdmin()
      .from('agent_runs')
      .select('*')
      .eq('project_id', threadId)
      .order('created_at', { ascending: true })
      .returns<Array<AgentRunRow>>()
    if (error) throw error
    return (data ?? []).map(toRunRecord)
  },
})

const metadata: MetadataStore = {
  async get(namespace, key) {
    const { data, error } = await supabaseAdmin()
      .from('agent_metadata')
      .select('value')
      .eq('namespace', namespace)
      .eq('key', key)
      .maybeSingle<{ value: unknown }>()
    if (error) throw error
    return data?.value ?? null
  },
  async set(namespace, key, value) {
    const { error } = await supabaseAdmin()
      .from('agent_metadata')
      .upsert({ namespace, key, value }, { onConflict: 'namespace,key' })
    if (error) throw error
  },
  async delete(namespace, key) {
    const { error } = await supabaseAdmin()
      .from('agent_metadata')
      .delete()
      .eq('namespace', namespace)
      .eq('key', key)
    if (error) throw error
  },
}

export const persistence: ChatTranscriptPersistence = defineAIPersistence({
  stores: { messages, runs, metadata },
})

export { getRunRow, runs as runStore }
