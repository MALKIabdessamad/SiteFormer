import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowUp, ChevronRight, Loader2, Square } from 'lucide-react'
import { reportClientError } from '~/lib/report-error'
import { cn } from '~/lib/utils/cn'
import type { Project } from '~/features/projects/types'
import { useAgentChat } from '../hooks/use-agent-chat'
import { useAttachments } from '../hooks/use-attachments'
import { uploadParts } from '../lib/attachments'
import { AttachButton, AttachmentChips, MessageAttachments } from './attachments'
import { isSettledRun, type AgentRun } from '../hooks/use-agent-runs'
import { buildTurns } from '../lib/turns'
import { CheckpointCard } from './checkpoint-card'
import { Markdown } from './markdown'
import { ToolStep } from './tool-step'

const MAX_MESSAGE = 8000

type AgentChatProps = {
  project: Project
  runs: Array<AgentRun>
  activeRun: AgentRun | undefined
  onRestored: () => void
  /** The live connection broke while a run is still going: the parent remounts the chat. */
  onConnectionLost: () => void
  /** Streaming started or stopped: the parent re-reads the runs (new run, final status). */
  onActivity: () => void
}

export function AgentChat({
  project,
  runs,
  activeRun,
  onRestored,
  onConnectionLost,
  onActivity,
}: AgentChatProps) {
  const chat = useAgentChat(project.id)
  const [draft, setDraft] = useState('')
  const [sendError, setSendError] = useState('')
  const attachments = useAttachments(project.id)
  const [dragging, setDragging] = useState(false)
  const listRef = useRef<HTMLOListElement>(null)
  const stickToBottom = useRef(true)

  const streaming = chat.isLoading || chat.status === 'streaming' || chat.status === 'submitted'
  const busy = streaming || Boolean(activeRun)
  const turns = useMemo(() => buildTurns(chat.messages, streaming), [chat.messages, streaming])

  useEffect(() => {
    onActivity()
  }, [streaming, onActivity])

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

  // Follow new output unless the user scrolled up to read.
  useEffect(() => {
    const list = listRef.current
    if (list && stickToBottom.current) list.scrollTop = list.scrollHeight
  }, [chat.messages])

  const send = async (event?: FormEvent) => {
    event?.preventDefault()
    const text = draft.trim()
    const uploads = attachments.ready
    if ((!text && uploads.length === 0) || busy || attachments.uploading) return
    setSendError('')
    setDraft('')
    attachments.clear()
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
      setDraft(text)
      const message = err instanceof Error ? err.message : 'Could not send. Try again.'
      setSendError(message)
      reportClientError('agent-send', message, { projectId: project.id })
    }
  }

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
        className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4"
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
          return (
            <li key={turn.key} className="space-y-2">
              {turn.attachments.length > 0 && <MessageAttachments ids={turn.attachments} />}
              {turn.user !== null && (
                <div className="flex justify-end">
                  <div className="max-w-[90%] rounded-2xl rounded-br-md bg-raised px-4 py-2.5 text-sm break-words whitespace-pre-wrap">
                    {turn.user}
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                {turn.segments.map((segment) =>
                  segment.kind === 'text' ? (
                    <Markdown key={segment.key} text={segment.text} />
                  ) : segment.kind === 'thinking' ? (
                    <Thinking key={segment.key} text={segment.text} />
                  ) : (
                    <ToolStep key={segment.key} step={segment.step} />
                  ),
                )}
              </div>
              {finished && run && (
                <CheckpointCard
                  projectId={project.id}
                  run={run}
                  latest={run.id === latestRunId}
                  locked={busy}
                  onRestored={onRestored}
                />
              )}
              {turn.notes.map((note, n) => (
                <p key={n} className="text-center text-[11px] text-faint">
                  {note}
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
        <div
          className={cn(
            'rounded-3xl p-2.5 box-sculpted focus-within:border-signal/70',
            dragging && 'border-signal/70 bg-signal/5',
          )}
        >
          <AttachmentChips items={attachments.items} onRemove={attachments.remove} />
          <div className="flex items-end gap-2">
            <AttachButton onFiles={attachments.add} count={attachments.items.length} />
            <label htmlFor="agent-input" className="sr-only">
              Message the agent
            </label>
            <textarea
              id="agent-input"
              rows={1}
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
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  void send()
                }
              }}
              placeholder={busy ? 'The agent is working… (you can stop it)' : 'Ask for a change…'}
              className="block max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-faint"
            />
            {busy ? (
              <button
                type="button"
                onClick={() => void chat.cancel(activeRun?.id ?? chat.runId ?? undefined)}
                aria-label="Stop the agent"
                title="Stop"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink box-sculpted hover:border-white/35"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={
                  (!draft.trim() && attachments.ready.length === 0) || attachments.uploading
                }
                title={attachments.uploading ? 'Uploading files…' : undefined}
                aria-label="Send"
                className="grid h-10 w-10 shrink-0 btn-sculpted place-items-center rounded-full disabled:cursor-not-allowed disabled:opacity-50"
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
