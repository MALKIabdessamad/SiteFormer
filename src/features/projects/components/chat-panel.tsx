import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, Eye, Loader2, PanelLeftClose, Trash2 } from 'lucide-react'
import { AgentChat, type AgentRun, type Composer } from '~/features/agent'
import { CreditsChip, type Account } from '~/features/billing'
import { toErrorMessage } from '~/lib/utils/errors'
import { setProjectMode } from '../api/projects.functions'
import type { ProjectMode } from '../lib/constants'
import type { Project } from '../types'
import { StatusLine } from './status-dot'

const iconButton =
  'grid h-9 w-9 shrink-0 place-items-center rounded-lg text-dim transition-colors hover:bg-ink/[0.06] hover:text-ink disabled:opacity-50'

type ChatPanelProps = {
  project: Project
  runs: Array<AgentRun>
  activeRun: AgentRun | undefined
  /** Bumped to remount the chat (fresh hydrate + rejoin). */
  chatKey: number
  deleting: boolean
  onDelete: () => void
  onShowPreview: () => void
  /** Desktop: hide the chat column. */
  onCollapse: () => void
  onRestored: () => void
  onConnectionLost: () => void
  onActivity: () => void
  onBusyChange: (busy: boolean) => void
  /** Re-reads the project (after its mode was saved). */
  onProjectChanged: () => Promise<unknown>
  composer: Composer
  /** The user's plan and credits (null while loading). */
  account: Account | null
}

/** Conversation column: project header + the coding agent's chat. */
export function ChatPanel({
  project,
  runs,
  activeRun,
  chatKey,
  deleting,
  onDelete,
  onShowPreview,
  onCollapse,
  onRestored,
  onConnectionLost,
  onActivity,
  onBusyChange,
  onProjectChanged,
  composer,
  account,
}: ChatPanelProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // The chosen mode shows at once; it's saved on the project (projects.mode) in the background.
  const [pendingMode, setPendingMode] = useState<ProjectMode | null>(null)
  const [modeError, setModeError] = useState('')
  const mode = pendingMode ?? project.mode

  const changeMode = async (next: ProjectMode) => {
    setPendingMode(next)
    setModeError('')
    try {
      await setProjectMode({ data: { projectId: project.id, mode: next } })
      await onProjectChanged()
    } catch (err) {
      setModeError(toErrorMessage(err))
    } finally {
      setPendingMode(null)
    }
  }

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
        <CreditsChip account={account} />
        <button
          type="button"
          onClick={onShowPreview}
          aria-label="Show preview and code"
          title="Preview & code"
          className={iconButton + ' md:hidden'}
        >
          <Eye className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          disabled={deleting || confirmingDelete}
          aria-label="Delete project"
          title="Delete project"
          className={iconButton + ' hover:text-danger'}
        >
          <Trash2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Hide chat"
          title="Hide chat"
          aria-expanded
          className={iconButton + ' hidden md:grid'}
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </header>

      {confirmingDelete && (
        <div
          role="alertdialog"
          aria-labelledby="delete-title"
          aria-describedby="delete-desc"
          className="mx-3 mb-1 rise rounded-2xl border border-danger/30 bg-danger/10 p-3"
        >
          <p id="delete-title" className="text-sm font-semibold">
            Delete this project?
          </p>
          <p id="delete-desc" className="mt-0.5 text-xs text-dim">
            Its sandbox and preview are deleted too. This can’t be undone.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              autoFocus
              onClick={() => setConfirmingDelete(false)}
              disabled={deleting}
              className="h-9 rounded-full px-4 text-sm font-medium text-dim transition-colors hover:bg-ink/[0.06] hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-danger px-4 text-sm font-semibold text-paper transition-opacity hover:opacity-90 disabled:opacity-70"
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      )}

      <AgentChat
        key={chatKey}
        project={project}
        runs={runs}
        activeRun={activeRun}
        onRestored={onRestored}
        onConnectionLost={onConnectionLost}
        onActivity={onActivity}
        onBusyChange={onBusyChange}
        outOfCredits={account !== null && account.credits < 1}
        mode={mode}
        onModeChange={changeMode}
        modeSaving={pendingMode !== null}
        composer={composer}
      />
      {modeError && (
        <p role="alert" className="mx-3 mb-2 text-xs text-danger">
          {modeError}
        </p>
      )}
    </section>
  )
}
