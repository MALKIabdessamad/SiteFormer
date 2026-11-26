/**
 * Long-term memory for the agent (@tanstack/ai-memory adapter backed by Supabase).
 *
 * Token-light by design:
 * - No extra model call per turn: the agent saves facts deliberately with the `remember` tool
 *   (the adapter's `save` is a no-op), instead of an LLM extracting facts after every turn.
 * - Recall injects at most 8 short memories (best text matches + most recent), ~150 tokens.
 *
 * Scope is derived server-side (verified user + owned project), never from the request body.
 */
import { toolDefinition, type Tool } from '@tanstack/ai'
import type { MemoryAdapter, MemoryScope } from '@tanstack/ai-memory'
import { z } from 'zod'
import { supabaseAdmin } from '../supabase-admin.server'

const RECALL_LIMIT = 8
/** Hard cap per user, so a looping model can't fill the table. */
const MAX_MEMORIES_PER_USER = 300

type MemoryRow = { id: string; kind: string; content: string; project_id: string | null }

function requireScope(scope: MemoryScope): { userId: string; projectId: string } {
  if (!scope.userId) throw new Error('Memory scope needs a userId')
  return { userId: scope.userId, projectId: scope.threadId }
}

function memoryTools(scope: MemoryScope): Array<Tool> {
  const { userId, projectId } = requireScope(scope)

  const remember = toolDefinition({
    name: 'remember',
    description:
      'Save a durable fact for future conversations: a user preference ("prefers dark mode"), a ' +
      'project fact ("brand colour is #1f6f43"), or a decision ("checkout uses Stripe"). Only ' +
      'things worth knowing next time; never secrets or one-off details.',
    inputSchema: z.object({
      content: z
        .string()
        .min(3)
        .max(500)
        .describe('One self-contained fact, max 500 characters. Save separate facts separately.'),
      kind: z.enum(['fact', 'preference', 'decision']),
      scope: z
        .enum(['project', 'user'])
        .describe(
          '"user" = applies to all of this user\'s projects (preferences); else "project".',
        ),
    }),
  }).server(async ({ content, kind, scope: target }) => {
    const db = supabaseAdmin()
    const { count } = await db
      .from('agent_memories')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
    if ((count ?? 0) >= MAX_MEMORIES_PER_USER) {
      return { saved: false, reason: 'Memory is full. Forget something outdated first.' }
    }
    const text = content.replace(/\s+/g, ' ').trim()
    const { data: existing } = await db
      .from('agent_memories')
      .select('id')
      .eq('user_id', userId)
      .eq('content', text)
      .limit(1)
    if (existing?.length) return { saved: true, note: 'Already remembered.' }
    const { error } = await db.from('agent_memories').insert({
      user_id: userId,
      project_id: target === 'user' ? null : projectId,
      kind,
      content: text,
    })
    if (error) throw error
    return { saved: true }
  })

  const forget = toolDefinition({
    name: 'forget_memory',
    description: 'Delete a remembered item that is wrong or outdated, by the id shown in memory.',
    inputSchema: z.object({
      id: z
        .string()
        .regex(/^[0-9a-f]{8}$/)
        .describe('8-character id'),
    }),
  }).server(async ({ id }) => {
    const db = supabaseAdmin()
    const { data } = await db
      .from('agent_memories')
      .select('id')
      .eq('user_id', userId)
      .or(`project_id.eq.${projectId},project_id.is.null`)
      .returns<Array<{ id: string }>>()
    const match = (data ?? []).find((row) => row.id.startsWith(id))
    if (!match) return { deleted: false, reason: 'No memory with that id.' }
    const { error } = await db.from('agent_memories').delete().eq('id', match.id)
    if (error) throw error
    return { deleted: true }
  })

  return [remember, forget]
}

function render(rows: Array<MemoryRow>): string {
  if (rows.length === 0) {
    return '## Memory\nNothing remembered yet. Use `remember` for durable preferences and facts.'
  }
  const lines = rows.map(
    (row) =>
      `- [${row.id.slice(0, 8)}] (${row.project_id ? 'project' : 'user'} ${row.kind}) ${row.content}`,
  )
  return [
    '## Memory (from earlier conversations; trust it unless the user says otherwise)',
    ...lines,
  ].join('\n')
}

export function supabaseMemory(): MemoryAdapter {
  return {
    id: 'supabase-memory',
    name: 'Supabase memory',

    async recall(scope, query) {
      const { userId, projectId } = requireScope(scope)
      const { data, error } = await supabaseAdmin().rpc('recall_agent_memories', {
        p_user_id: userId,
        p_project_id: projectId,
        p_query: query,
        p_limit: RECALL_LIMIT,
      })
      if (error) throw error
      return {
        systemPrompt: render((data ?? []) as Array<MemoryRow>),
        tools: memoryTools(scope),
      }
    },

    // Facts are saved deliberately through the `remember` tool: no per-turn extraction call.
    async save() {
      return []
    },
  }
}
