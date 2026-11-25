import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, ArrowUp, Clock, Eye, Loader2, Trash2 } from 'lucide-react'
import type { Project } from '../types'
import { StatusLine } from './status-dot'

const iconButton =
  'grid h-9 w-9 shrink-0 place-items-center rounded-lg text-dim transition-colors hover:bg-ink/[0.06] hover:text-ink disabled:opacity-50'

type ChatPanelProps = {
  project: Project
  deleting: boolean
  onDelete: () => void
  onShowPreview: () => void
}

/**
 * Conversation column. The AI agent isn't connected yet: the first prompt is shown as queued and
 * the composer is disabled. The agent will consume the queued prompt once it exists.
 */
export function ChatPanel({ project, deleting, onDelete, onShowPreview }: ChatPanelProps) {
  return (
    <section aria-label="Chat" className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-1 px-2">
        <Link
          to="/dashboard"
          aria-label="Back to dashboard"
          title="All projects"
          className={iconButton}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1 px-1">
          <h1
            className="truncate font-display text-[15px] leading-tight font-bold tracking-tight"
            title={project.name}
          >
            {project.name}
          </h1>
          <StatusLine status={project.status} />
        </div>
        <button
          type="button"
          onClick={onShowPreview}
          aria-label="Show preview"
          title="Show preview"
          className={iconButton + ' md:hidden'}
        >
          <Eye className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          aria-label="Delete project"
          title="Delete project"
          className={iconButton + ' hover:text-danger'}
        >
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </button>
      </header>

      <ol className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <li className="flex flex-col items-end gap-1.5">
          <div className="max-w-[90%] rounded-2xl rounded-br-md bg-raised px-4 py-3 text-sm break-words whitespace-pre-wrap">
            {project.prompt}
          </div>
          <span className="inline-flex items-center gap-1 text-[11px] text-faint">
            <Clock className="h-3 w-3" aria-hidden />
            Queued
          </span>
        </li>
        <li>
          <AgentNote status={project.status} />
        </li>
      </ol>

      <div className="shrink-0 p-3">
        <div className="flex items-end gap-2 rounded-3xl p-2.5 opacity-70 box-sculpted">
          <label htmlFor="chat-input" className="sr-only">
            Message
          </label>
          <textarea
            id="chat-input"
            rows={1}
            disabled
            placeholder="The AI agent is coming soon…"
            className="block max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-faint"
          />
          <button
            type="button"
            disabled
            aria-label="Send"
            className="grid h-10 w-10 shrink-0 btn-sculpted place-items-center rounded-full disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  )
}

function AgentNote({ status }: { status: Project['status'] }) {
  const notes: Record<Project['status'], ReactNode> = {
    provisioning: (
      <>
        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-signal" aria-hidden />
        Setting up your sandbox. Your prompt is queued and will run as soon as it’s ready.
      </>
    ),
    ready: (
      <>
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-signal" aria-hidden />
        Your sandbox is ready with the starter app. The AI agent isn’t connected yet, so your prompt
        stays queued.
      </>
    ),
    failed: (
      <>
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
        The sandbox couldn’t be set up. Retry from the preview panel; your prompt is still queued.
      </>
    ),
  }
  return (
    <div className="flex w-fit max-w-[95%] gap-2.5 rounded-2xl rounded-bl-md border bg-ink/[0.03] px-4 py-3 text-sm text-dim">
      {notes[status]}
    </div>
  )
}
