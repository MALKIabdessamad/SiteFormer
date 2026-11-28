/**
 * The pieces of a chat turn: the user's message (and editing it), the agent's reply, and notes
 * about things done outside the chat.
 */
import { Link } from '@tanstack/react-router'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronRight, Coins, History, Loader2, PencilLine } from 'lucide-react'
import { cn } from '~/lib/utils/cn'
import { splitReferences } from '../lib/references'
import type { Segment } from '../lib/turns'
import { ElementChip } from './element-chip'
import { Markdown } from './markdown'
import { PlanCard, ToolStep } from './tool-step'

/** Longest message (the server refuses longer ones). */
export const MAX_MESSAGE = 8000

/** The user's message; elements they pointed at in the preview show as chips. */
export function UserMessage({ text, onEdit }: { text: string; onEdit?: () => void }) {
  const { text: body, refs } = splitReferences(text)
  return (
    <div className="group flex items-end justify-end gap-1">
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label="Edit your message"
          title="Edit"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:bg-ink/[0.06] hover:text-ink focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <PencilLine className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
      <div className="max-w-[90%] rounded-2xl rounded-br-md bg-raised px-4 py-2.5 text-sm break-words whitespace-pre-wrap">
        {body}
        {refs.length > 0 && (
          <div className={cn('flex flex-wrap gap-1.5 whitespace-normal', body && 'mt-2')}>
            {refs.map((ref, i) => (
              <ElementChip
                key={i}
                tag={ref.tag}
                title={`${ref.text}${ref.note ? ` — ${ref.note}` : ''} · ${ref.loc}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The latest message, edited where it is. Sending it puts the project back to how it was before
 * that message, then sends the new version (with the same files and selected element).
 */
export function MessageEditor({
  text,
  sending,
  onCancel,
  onSend,
}: {
  text: string
  sending: boolean
  onCancel: () => void
  onSend: (text: string) => void
}) {
  const { text: body, refs } = splitReferences(text)
  const [value, setValue] = useState(body)
  const input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = input.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [value])
  const empty = !value.trim() && refs.length === 0
  return (
    <div className="flex justify-end">
      <div className="w-full max-w-[90%] rounded-2xl rounded-br-md border border-signal/40 bg-raised p-2">
        <textarea
          ref={input}
          value={value}
          rows={1}
          maxLength={MAX_MESSAGE}
          disabled={sending}
          aria-label="Edit your message"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onCancel()
            } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              if (!empty && !sending) onSend(value)
            }
          }}
          className="block w-full resize-none bg-transparent px-2 py-1 text-sm leading-5 outline-none"
        />
        {refs.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-2 pt-1">
            {refs.map((ref, i) => (
              <ElementChip key={i} tag={ref.tag} title={`${ref.text} · ${ref.loc}`} />
            ))}
          </div>
        )}
        <p className="px-2 pt-1.5 text-[11px] text-faint">
          Sending undoes what this message changed, then sends it again.
        </p>
        <div className="mt-2 flex justify-end gap-1.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={sending}
            className="h-8 rounded-full px-3 text-xs font-medium text-dim hover:bg-ink/[0.06] hover:text-ink disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSend(value)}
            disabled={empty || sending}
            className="inline-flex h-8 btn-sculpted items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

/** The agent's reply: text, thinking, the plan (shown once, kept current) and tool steps. */
export function ReplyBody({
  segments,
  settled,
  completed,
}: {
  segments: ReadonlyArray<Segment>
  /** The reply is over (its run settled, or the agent isn't busy any more). */
  settled: boolean
  /** It ended well (not failed or stopped). */
  completed: boolean
}) {
  const plans = segments.filter(
    (s): s is Extract<Segment, { kind: 'tool' }> =>
      s.kind === 'tool' && s.step.name === 'update_plan',
  )
  const latestPlan = plans.at(-1)?.step.input.steps
  return (
    <div className="space-y-1.5">
      {groupSegments(segments).map((group) =>
        group.kind === 'tools' ? (
          <ToolGroup key={group.key} segments={group.segments} />
        ) : group.segment.kind === 'text' ? (
          <Markdown key={group.key} text={group.segment.text} />
        ) : group.segment.kind === 'thinking' ? (
          <Thinking key={group.key} text={group.segment.text} />
        ) : group.segment.key === plans[0]?.key ? (
          <PlanCard key={group.key} steps={latestPlan} settled={settled} completed={completed} />
        ) : null,
      )}
    </div>
  )
}

/** A line in the chat about something done outside it (an edit, a restore, credits). */
export function ChatNote({ note }: { note: string }) {
  return (
    <p className="mx-auto flex w-fit max-w-full items-center gap-1.5 rounded-full border bg-ink/[0.03] px-3 py-1 text-[11px] text-dim">
      {note.startsWith('✎') ? (
        <PencilLine className="h-3 w-3 shrink-0 text-signal" aria-hidden />
      ) : note.startsWith('⚠') ? (
        <Coins className="h-3 w-3 shrink-0 text-danger" aria-hidden />
      ) : (
        <History className="h-3 w-3 shrink-0" aria-hidden />
      )}
      <span className="whitespace-normal">{note.replace(/^(↩︎|✎|⚠)\s*/, '')}</span>
      {note.startsWith('⚠') && (
        <Link to="/billing" className="shrink-0 font-semibold text-signal hover:underline">
          Get credits
        </Link>
      )}
    </p>
  )
}

function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="text-xs text-faint">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 hover:text-dim"
      >
        <ChevronRight
          className={cn('h-3 w-3 transition-transform', open && 'rotate-90')}
          aria-hidden
        />
        Thinking
      </button>
      {open && <p className="mt-1 ml-4 whitespace-pre-wrap">{text}</p>}
    </div>
  )
}

type Group =
  | { kind: 'one'; key: string; segment: Segment }
  | { kind: 'tools'; key: string; segments: Array<Extract<Segment, { kind: 'tool' }>> }

/** Consecutive tool calls (not plans) form one group, so long runs can fold. */
function groupSegments(segments: ReadonlyArray<Segment>): Array<Group> {
  const out: Array<Group> = []
  for (const segment of segments) {
    const last = out.at(-1)
    if (segment.kind === 'tool' && segment.step.name !== 'update_plan') {
      if (last?.kind === 'tools') last.segments.push(segment)
      else out.push({ kind: 'tools', key: segment.key, segments: [segment] })
    } else {
      out.push({ kind: 'one', key: segment.key, segment })
    }
  }
  return out
}

const SHOWN_STEPS = 3

/** A run of tool steps: the last few show; earlier ones fold behind "N more steps". */
function ToolGroup({ segments }: { segments: Array<Extract<Segment, { kind: 'tool' }>> }) {
  const [open, setOpen] = useState(false)
  const folded = open ? 0 : segments.length - SHOWN_STEPS
  const hidden = folded > 1 ? folded : 0
  return (
    <div className="space-y-0.5">
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 rounded-full py-0.5 text-xs text-faint transition-colors hover:text-dim"
        >
          <ChevronRight className="h-3 w-3" aria-hidden />
          {hidden} more steps
        </button>
      )}
      {segments.slice(hidden).map((segment) => (
        <ToolStep key={segment.key} step={segment.step} />
      ))}
    </div>
  )
}
