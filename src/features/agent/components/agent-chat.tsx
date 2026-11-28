import { Link } from '@tanstack/react-router'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  ArrowUp,
  ChevronRight,
  Clock,
  Coins,
  History,
  Loader2,
  PencilLine,
  Square,
  Trash2,
} from 'lucide-react'
import { reportClientError } from '~/lib/report-error'
import { cn } from '~/lib/utils/cn'
import type { Project, ProjectMode } from '~/features/projects'
import { useAgentChat } from '../hooks/use-agent-chat'
import { releaseAttachments, useAttachments, type Attachment } from '../hooks/use-attachments'
import type { Composer, QueuedMessage, SendOptions } from '../hooks/use-composer'
import { rewindLatestMessage } from '../api/checkpoints.functions'
import { messageUploads, uploadParts, type Upload } from '../lib/attachments'
import { referenceLine, referenceLinesOf, splitReferences } from '../lib/references'
import { AttachButton, AttachmentChips, MessageAttachments } from './attachments'
import { ElementChip } from './element-chip'
import { isSettledRun, type AgentRun } from '../hooks/use-agent-runs'
import { buildTurns, type Segment, type Turn } from '../lib/turns'
import { Markdown } from './markdown'
import { isModeShortcut, ModeMenu, nextMode } from './mode-menu'
import { ReplyActions } from './reply-actions'
import { PlanCard, ToolStep } from './tool-step'

const MAX_MESSAGE = 8000

type AgentChatProps = {
  project: Project
  runs: Array<AgentRun>
  activeRun: AgentRun | undefined
  onRestored: () => void
  /** The live connection broke while a run is still going: the parent remounts the chat. */
  onConnectionLost: () => void
  /** Streaming started or stopped: the parent re-reads the runs (new run, final status). */
  onActivity: () => unknown
  /** The agent started or stopped working (as this chat sees it, even without Realtime). */
  onBusyChange?: (busy: boolean) => void
  /** No credits left: the composer offers to get more instead of sending. */
  outOfCredits?: boolean
  /** Build (the agent edits) or Chat (read-only). Saved on the project. */
  mode: ProjectMode
  onModeChange: (mode: ProjectMode) => Promise<void>
  /** A mode change is being saved: sending waits for it. */
  modeSaving?: boolean
  /** Draft, picked elements and queue (they outlive this component), and the workspace's handle. */
  composer: Composer
}

export function AgentChat({
  project,
  runs,
  activeRun,
  onRestored,
  onConnectionLost,
  onActivity,
  onBusyChange,
  outOfCredits = false,
  mode,
  onModeChange,
  modeSaving = false,
  composer,
}: AgentChatProps) {
  const chat = useAgentChat(project.id)
  // The latest message, edited in place: sending it again first undoes what it changed.
  const [editing, setEditing] = useState<string | null>(null)
  const [rewinding, setRewinding] = useState(false)
  const [draft, setDraftState] = useState(composer.readDraft)
  const setDraft = (value: string) => {
    composer.saveDraft(value)
    setDraftState(value)
  }
  const [sendError, setSendError] = useState('')
  const attachments = useAttachments(project.id)
  const [dragging, setDragging] = useState(false)
  const listRef = useRef<HTMLOListElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stickToBottom = useRef(true)

  const streaming = chat.isLoading || chat.status === 'streaming' || chat.status === 'submitted'
  const busy = streaming || Boolean(activeRun)
  // The server takes the next message once the last run is fully done (checkpoint written).
  const lastRun = runs.at(-1)
  const free = !busy && (!lastRun || isSettledRun(lastRun))
  // One-click next steps for the last reply, on top of the composer.
  const suggestions = (free && lastRun?.suggestions) || []
  const turns = useMemo(() => buildTurns(chat.messages, streaming), [chat.messages, streaming])
  const userTurns = turns.filter((turn) => turn.user !== null)
  const editable =
    free &&
    !outOfCredits &&
    !modeSaving &&
    project.status === 'ready' &&
    runs.length > 0 &&
    runs.length === userTurns.length
      ? userTurns.at(-1)?.key
      : undefined
  const editingKey = editable === editing || rewinding ? editing : null

  useEffect(() => {
    onActivity()
  }, [streaming, onActivity])

  useEffect(() => {
    onBusyChange?.(busy)
  }, [busy, onBusyChange])

  // Every chat error reaches the server logs (Railway), not just the user's screen.
  useEffect(() => {
    if (chat.error) {
      reportClientError('agent-chat', chat.error.message, {
        projectId: project.id,
        detail: activeRun ? `active run ${activeRun.id} (${activeRun.status})` : 'no active run',
      })
    }
  }, [chat.error, project.id, activeRun])

  // Self-heal: if the live stream errors while the run is still active, reconnect.
  useEffect(() => {
    if (!chat.error || !activeRun) return
    const timer = setTimeout(onConnectionLost, 1500)
    return () => clearTimeout(timer)
  }, [chat.error, activeRun, onConnectionLost])

  // The input grows with its text (up to its max height).
  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 200)}px`
  }, [draft])

  // Follow new output (and the reply's action row once its run settles) unless the user
  // scrolled up to read.
  useEffect(() => {
    const list = listRef.current
    if (list && stickToBottom.current) list.scrollTop = list.scrollHeight
  }, [chat.messages, runs])

  /** Sends a message now. Throws (after showing why) when it couldn't be sent. */
  const deliver = async (text: string, uploads: Array<Upload>) => {
    setSendError('')
    stickToBottom.current = true
    try {
      if (uploads.length) {
        await chat.sendMessage({
          content: [
            { type: 'text', content: text || 'Use the attached files.' },
            ...uploadParts(uploads),
          ],
        } as Parameters<typeof chat.sendMessage>[0])
      } else {
        await chat.sendMessage(text)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not send. Try again.'
      setSendError(message)
      reportClientError('agent-send', message, { projectId: project.id })
      throw err
    }
  }

  const enqueue = (text: string, uploads: Array<Upload>, items?: Array<Attachment>) =>
    composer.setQueue((queue) => [
      ...queue,
      { id: crypto.randomUUID(), text, uploads, attachments: items },
    ])

  const resend = async (turn: Turn, run: AgentRun, typed: string) => {
    const message = chat.messages.find((m) => m.id === turn.key)
    const uploads = message ? messageUploads(message) : []
    const text = [typed.trim(), ...referenceLinesOf(turn.user ?? '')].filter(Boolean).join('\n')
    if (!text && uploads.length === 0) return
    setRewinding(true)
    setSendError('')
    try {
      await rewindLatestMessage({ data: { projectId: project.id, runId: run.id } })
      // The conversation here ends before that message too, and its run leaves the list
      // before the new one arrives.
      const at = chat.messages.findIndex((m) => m.id === turn.key)
      if (at >= 0) chat.setMessages(chat.messages.slice(0, at))
      await onActivity()
      setEditing(null)
      await deliver(text, uploads)
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Could not send. Try again.')
    } finally {
      setRewinding(false)
    }
  }

  /** Cancel: the queued message is deleted. */
  const cancelQueued = (item: QueuedMessage) => {
    composer.setQueue((queue) => queue.filter((queued) => queued.id !== item.id))
    releaseAttachments(item.attachments)
  }

  /**
   * Edit: the queued message goes back into the message box (before anything typed there since),
   * with its files and its selected element.
   */
  const editQueued = (item: QueuedMessage) => {
    composer.setQueue((queue) => queue.filter((queued) => queued.id !== item.id))
    const { text, refs } = splitReferences(item.text)
    setDraft(draft.trim() ? `${text}\n\n${draft}` : text)
    const ref = refs[0]
    if (ref) {
      const { loc, tag, text: refText, path } = ref
      composer.setPicks([{ n: 1, element: { loc, tag, text: refText, path } }])
    }
    attachments.restore(
      item.attachments ??
        item.uploads.map((upload) => ({
          key: crypto.randomUUID(),
          file: new File([], upload.name, { type: upload.mime }),
          preview: null,
          status: 'ready' as const,
          upload,
        })),
    )
    inputRef.current?.focus()
  }

  /** The composer's message: the typed text, then a line for the element picked in the preview. */
  const send = async (event?: FormEvent) => {
    event?.preventDefault()
    const typed = draft.trim()
    const uploads = attachments.ready
    // Picked elements say where; the typed text (or a drawing) says what.
    if ((!typed && uploads.length === 0) || attachments.uploading || outOfCredits || modeSaving)
      return
    const picks = composer.picks.map((pick) => referenceLine(pick.element))
    const drawingOnly = !typed && uploads.every((u) => u.name.startsWith('Drawing on '))
    const text = [typed || (drawingOnly ? 'Change what I marked in my drawing.' : ''), ...picks]
      .filter(Boolean)
      .join('\n')
    setDraft('')
    composer.setPicks([])
    // Queued: its files stay with it (with their previews), to put back if it's edited.
    if (!free) return enqueue(text, uploads, attachments.take())
    attachments.clear()
    try {
      await deliver(text, uploads)
    } catch {
      setDraft(text)
    }
  }

  // Queued messages go one by one, each once the agent is free again (a failed send goes back
  // to the front of the queue).
  const { setQueue } = composer
  const deliverLatest = useRef(deliver)
  useEffect(() => {
    deliverLatest.current = deliver
  })
  const flushing = useRef(false)
  const nextQueued = composer.queue[0]
  useEffect(() => {
    if (!nextQueued || !free || outOfCredits || modeSaving || flushing.current) return
    flushing.current = true
    setQueue((queue) => queue.filter((item) => item.id !== nextQueued.id))
    deliverLatest
      .current(nextQueued.text, nextQueued.uploads)
      .then(() => releaseAttachments(nextQueued.attachments))
      .catch(() => setQueue((queue) => [nextQueued, ...queue]))
      .finally(() => {
        flushing.current = false
      })
  }, [nextQueued, free, outOfCredits, modeSaving, setQueue])

  // The workspace (preview tools, fixes) sends through here: queued while the agent works.
  const external = useRef<(text: string, options?: SendOptions) => Promise<void>>(() =>
    Promise.resolve(),
  )
  // Edits made outside the chat (Code tab, visual editor) show their note at once.
  const appendNote = useRef<(note: string) => void>(() => undefined)
  const attachLatest = useRef(attachments.addUploaded)
  useEffect(() => {
    external.current = async (text, { mode: wanted, uploads = [] } = {}) => {
      if (wanted && wanted !== mode) await onModeChange(wanted)
      if (!free) return enqueue(text, uploads)
      await deliver(text, uploads).catch(() => undefined)
    }
    attachLatest.current = attachments.addUploaded
    appendNote.current = (note) => {
      const last = chat.messages.at(-1)
      const lastText = last?.parts.map((p) => (p.type === 'text' ? p.content : '')).join('')
      if (last?.role === 'assistant' && lastText === note) return // the server skips repeats too
      chat.setMessages([
        ...chat.messages,
        {
          id: `note-${crypto.randomUUID()}`,
          role: 'assistant',
          parts: [{ type: 'text', content: note }],
        },
      ])
    }
  })
  const { register } = composer
  useEffect(
    () =>
      register({
        send: (text, options) => external.current(text, options),
        addNote: (note) => appendNote.current(note),
        attach: (file, upload) => attachLatest.current(file, upload),
        // After the chat is shown (phones show one panel at a time).
        focus: () => requestAnimationFrame(() => inputRef.current?.focus()),
      }),
    [register],
  )

  const waitingForSandbox = Boolean(activeRun) && project.status !== 'ready'
  const latestRunId = runs.at(-1)?.id

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ol
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
        className="relative min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4"
        aria-live="polite"
      >
        {chat.isHydrating && turns.length === 0 && (
          <li className="flex justify-center py-10 text-dim">
            <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading conversation" />
          </li>
        )}
        {turns.map((turn, index) => {
          const run =
            turn.user !== null
              ? runs[turns.slice(0, index).filter((t) => t.user !== null).length]
              : undefined
          const finished = isSettledRun(run)
          // The reply is over when its run settled, or (last turn) when the agent isn't busy.
          const settled = finished || index < turns.length - 1 || !busy
          const completed = settled && run?.status !== 'failed' && run?.status !== 'aborted'
          const plans = turn.segments.filter(
            (s): s is Extract<Segment, { kind: 'tool' }> =>
              s.kind === 'tool' && s.step.name === 'update_plan',
          )
          const latestPlan = plans.at(-1)?.step.input.steps
          return (
            <li key={turn.key} className="space-y-2">
              {turn.attachments.length > 0 && <MessageAttachments ids={turn.attachments} />}
              {turn.user !== null &&
                (editingKey === turn.key && run ? (
                  <MessageEditor
                    text={turn.user}
                    sending={rewinding}
                    onCancel={() => setEditing(null)}
                    onSend={(typed) => void resend(turn, run, typed)}
                  />
                ) : (
                  <UserMessage
                    text={turn.user}
                    onEdit={editable === turn.key ? () => setEditing(turn.key) : undefined}
                  />
                ))}
              <div className="space-y-1.5">
                {groupSegments(turn.segments).map((group) =>
                  group.kind === 'tools' ? (
                    <ToolGroup key={group.key} segments={group.segments} />
                  ) : group.segment.kind === 'text' ? (
                    <Markdown key={group.key} text={group.segment.text} />
                  ) : group.segment.kind === 'thinking' ? (
                    <Thinking key={group.key} text={group.segment.text} />
                  ) : group.segment.key === plans[0]?.key ? (
                    <PlanCard
                      key={group.key}
                      steps={latestPlan}
                      settled={settled}
                      completed={completed}
                    />
                  ) : null,
                )}
              </div>
              {finished && run && (
                <ReplyActions
                  projectId={project.id}
                  run={run}
                  latest={run.id === latestRunId}
                  changedSince={turn.notes.some((note) => !note.startsWith('⚠'))}
                  locked={busy}
                  onRestored={onRestored}
                />
              )}
              {turn.notes.map((note, n) => (
                <p
                  key={n}
                  className="mx-auto flex w-fit max-w-full items-center gap-1.5 rounded-full border bg-ink/[0.03] px-3 py-1 text-[11px] text-dim"
                >
                  {note.startsWith('✎') ? (
                    <PencilLine className="h-3 w-3 shrink-0 text-signal" aria-hidden />
                  ) : note.startsWith('⚠') ? (
                    <Coins className="h-3 w-3 shrink-0 text-danger" aria-hidden />
                  ) : (
                    <History className="h-3 w-3 shrink-0" aria-hidden />
                  )}
                  <span className="whitespace-normal">{note.replace(/^(↩︎|✎|⚠)\s*/, '')}</span>
                  {note.startsWith('⚠') && (
                    <Link
                      to="/billing"
                      className="shrink-0 font-semibold text-signal hover:underline"
                    >
                      Get credits
                    </Link>
                  )}
                </p>
              ))}
            </li>
          )
        })}
        {busy && (
          <li className="flex items-center gap-2 text-xs text-dim" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-signal" aria-hidden />
            {waitingForSandbox
              ? project.status === 'failed'
                ? 'Waiting for the sandbox: its setup failed. Use “Try again” in the preview panel.'
                : 'Setting up your sandbox. Your message runs as soon as it’s ready.'
              : 'Working…'}
          </li>
        )}
      </ol>

      <form
        onSubmit={send}
        className="shrink-0 p-3"
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.types).includes('Files')) {
            e.preventDefault()
            setDragging(true)
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          attachments.add(Array.from(e.dataTransfer.files))
        }}
      >
        {outOfCredits && !busy && (
          <p
            role="status"
            className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-ink"
          >
            You’re out of credits.
            <Link to="/billing" className="shrink-0 font-semibold text-signal hover:underline">
              Get credits
            </Link>
          </p>
        )}
        {attachments.notice && (
          <p className="mb-2 px-1 text-xs text-danger">{attachments.notice}</p>
        )}
        {(sendError || (chat.error && !activeRun)) && (
          <p
            role="alert"
            className="mb-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
          >
            {sendError || chat.error?.message}
          </p>
        )}
        {suggestions.length > 0 && (
          <div
            aria-label="Suggested next steps"
            className="-mx-3 mb-2 no-scrollbar flex gap-1.5 overflow-x-auto [mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-12px),transparent)] px-3"
          >
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => void external.current(suggestion)}
                disabled={outOfCredits}
                title={suggestion}
                className="h-8 max-w-[16rem] shrink-0 truncate rounded-full border bg-raised px-3 text-xs text-dim transition-colors hover:border-signal/50 hover:text-ink disabled:opacity-50"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
        {composer.queue.length > 0 && (
          <ul aria-label="Queued messages" className="mb-2 space-y-1">
            {composer.queue.map((item) => {
              const files = item.attachments?.length ?? item.uploads.length
              return (
                <li
                  key={item.id}
                  title="Sends when the agent is done"
                  className="flex items-center gap-1 rounded-xl border bg-ink/[0.02] py-1 pr-1 pl-3 text-xs text-dim"
                >
                  <Clock className="mr-1 h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">
                    {splitReferences(item.text).text || item.text}
                  </span>
                  {files > 0 && (
                    <span className="shrink-0 text-faint">
                      {files === 1 ? '1 file' : `${files} files`}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => editQueued(item)}
                    aria-label="Edit this message"
                    title="Edit"
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-faint hover:bg-ink/[0.06] hover:text-ink"
                  >
                    <PencilLine className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => cancelQueued(item)}
                    aria-label="Cancel this message"
                    title="Cancel"
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-faint hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <div
          className={cn(
            'rounded-[22px] p-2 box-sculpted transition-colors focus-within:border-signal/60',
            dragging && 'border-signal/70 bg-signal/5',
          )}
        >
          <AttachmentChips items={attachments.items} onRemove={attachments.remove} />
          {composer.picks.length > 0 && (
            <div aria-label="Selected element" className="mb-1 flex flex-wrap gap-1.5 px-1 pt-1">
              {composer.picks.map((pick) => (
                <ElementChip
                  key={pick.n}
                  tag={pick.element.tag}
                  title={`${pick.element.text} · ${pick.element.loc}`}
                  onRemove={() => composer.setPicks([])}
                />
              ))}
            </div>
          )}
          <label htmlFor="agent-input" className="sr-only">
            Message the agent
          </label>
          <textarea
            ref={inputRef}
            id="agent-input"
            rows={2}
            value={draft}
            maxLength={MAX_MESSAGE}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files)
              if (files.length) {
                e.preventDefault()
                attachments.add(files)
              }
            }}
            onKeyDown={(e) => {
              if (isModeShortcut(e)) {
                e.preventDefault()
                if (!modeSaving) void onModeChange(nextMode(mode))
              } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder={
              project.status === 'provisioning'
                ? 'Waiting for the sandbox…'
                : busy
                  ? 'Type your next message (it sends when the agent is done)'
                  : composer.picks.length > 0
                    ? mode === 'chat'
                      ? 'Ask about the selected element…'
                      : 'Ask to change the selected element…'
                    : mode === 'chat'
                      ? 'Ask anything about your project…'
                      : 'Ask for a change…'
            }
            className="block min-h-12 w-full resize-none overflow-y-auto bg-transparent px-2 pt-1.5 text-sm leading-5 outline-none placeholder:text-faint"
          />
          <div className="mt-1 flex items-center gap-1">
            <AttachButton onFiles={attachments.add} count={attachments.items.length} />
            <span className="flex-1" />
            <ModeMenu mode={mode} disabled={modeSaving} onChange={onModeChange} />
            {busy && (
              <button
                type="button"
                onClick={() => void chat.cancel(activeRun?.id ?? chat.runId ?? undefined)}
                aria-label="Stop the agent"
                title="Stop"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink box-sculpted hover:border-white/35"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            )}
            {(!busy || draft.trim()) && (
              <button
                type="submit"
                disabled={
                  (!draft.trim() && attachments.ready.length === 0) ||
                  attachments.uploading ||
                  outOfCredits ||
                  modeSaving
                }
                title={
                  attachments.uploading
                    ? 'Uploading files…'
                    : busy
                      ? 'Send when the agent is done'
                      : undefined
                }
                aria-label={busy ? 'Queue message' : 'Send'}
                className="grid h-9 w-9 shrink-0 btn-sculpted place-items-center rounded-full disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  )
}

/** The user's message; elements they pointed at in the preview show as chips. */
function UserMessage({ text, onEdit }: { text: string; onEdit?: () => void }) {
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
function MessageEditor({
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
