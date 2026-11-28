/**
 * The conversation as stored (one model message per row, see persistence.server.ts): adding the
 * user's message and short notes, repairing a transcript a restart cut mid-tool, and taking back
 * the latest message to send it again edited.
 */
import type { ContentPart, ModelMessage } from '@tanstack/ai'
import { uploadSource } from '~/features/agent/lib/upload-ref'
import { supabaseAdmin } from '../supabase-admin.server'
import { persistence, type AgentRunRow } from './persistence.server'
import type { UploadRow } from './uploads.server'

export async function appendUserMessage(
  projectId: string,
  prompt: string,
  attachments: Array<UploadRow>,
) {
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

/** The text of a stored user message. */
function userText(message: ModelMessage): string {
  if (typeof message.content === 'string') return message.content
  return (message.content ?? []).map((part) => (part.type === 'text' ? part.content : '')).join('')
}

/** The project's latest run that is still part of the conversation. */
export async function latestRun(projectId: string): Promise<AgentRunRow | null> {
  const { data, error } = await supabaseAdmin()
    .from('agent_runs')
    .select('*')
    .eq('project_id', projectId)
    .is('superseded_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<AgentRunRow>()
  if (error) throw error
  return data
}

/**
 * Takes a run's message out of the conversation (the user edits it and sends it again): the
 * transcript ends before it, and the run stays on record, marked superseded. The message is only
 * removed while it is the transcript's latest user message, so a repeat never removes an
 * earlier one.
 */
export async function withdrawLatestMessage(run: AgentRunRow): Promise<void> {
  const messages = await persistence.stores.messages.loadThread(run.project_id)
  let at = messages.length - 1
  while (at >= 0 && messages[at]!.role !== 'user') at--
  if (at >= 0 && userText(messages[at]!).trim() === run.prompt.trim()) {
    await persistence.stores.messages.saveThread(run.project_id, messages.slice(0, at))
  }
  const { error } = await supabaseAdmin()
    .from('agent_runs')
    .update({ superseded_at: new Date().toISOString() })
    .eq('id', run.id)
  if (error) throw error
}

/**
 * A run interrupted mid-tool (server restart) can end with tool calls that have no results, which
 * models reject. Close them with an explanatory result so the model can redo what it needs.
 */
export async function repairInterruptedTranscript(projectId: string) {
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
