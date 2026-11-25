import type { UIMessage } from '@tanstack/ai-react'
import type { ToolStepData } from '../components/tool-step'

/** A rendered chunk of an assistant message, in order. */
export type Segment =
  | { kind: 'text'; key: string; text: string }
  | { kind: 'thinking'; key: string; text: string }
  | { kind: 'tool'; key: string; step: ToolStepData }

/** One user message and everything the agent did in reply (= one agent run). */
export type Turn = {
  key: string
  user: string | null
  segments: Array<Segment>
  notes: Array<string>
}

function parseJson(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object') return value as Record<string, unknown>
  if (typeof value !== 'string' || !value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : { result: parsed }
  } catch {
    return { result: value }
  }
}

const textOf = (message: UIMessage) =>
  message.parts
    .map((p) => (p.type === 'text' ? p.content : ''))
    .join('')
    .trim()

/**
 * Groups the transcript into turns (each user message starts one) and flattens assistant parts
 * into ordered segments, pairing every tool call with its result.
 */
export function buildTurns(messages: ReadonlyArray<UIMessage>, streaming: boolean): Array<Turn> {
  const results = new Map<string, Record<string, unknown> | null>()
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === 'tool-result') results.set(part.toolCallId, parseJson(part.content))
    }
  }

  const turns: Array<Turn> = []
  let current: Turn | null = null
  for (const message of messages) {
    if (message.role === 'user') {
      current = { key: message.id, user: textOf(message), segments: [], notes: [] }
      turns.push(current)
      continue
    }
    if (message.role !== 'assistant') continue
    if (!current) {
      current = { key: `pre-${message.id}`, user: null, segments: [], notes: [] }
      turns.push(current)
    }
    // A plain restore note (no tools) is shown as a system-style line, not as a reply.
    const text = textOf(message)
    if (text.startsWith('↩︎') && message.parts.every((p) => p.type === 'text')) {
      current.notes.push(text)
      continue
    }
    message.parts.forEach((part, n) => {
      const key = `${message.id}:${n}`
      if (part.type === 'text' && part.content.trim()) {
        current!.segments.push({ kind: 'text', key, text: part.content })
      } else if (part.type === 'thinking' && part.content.trim()) {
        current!.segments.push({ kind: 'thinking', key, text: part.content })
      } else if (part.type === 'tool-call') {
        const output = parseJson(part.output) ?? results.get(part.id) ?? null
        current!.segments.push({
          kind: 'tool',
          key,
          step: {
            id: part.id,
            name: part.name,
            input: parseJson(part.input) ?? parseJson(part.arguments) ?? {},
            output,
            running: streaming && output === null,
          },
        })
      }
    })
  }
  return turns
}
