import { useState } from 'react'
import { Coins, History, Loader2, Undo2 } from 'lucide-react'
import { toErrorMessage } from '~/lib/utils/errors'
import { restoreToCheckpoint } from '../api/checkpoints.functions'
import type { AgentRun } from '../hooks/use-agent-runs'

type ReplyActionsProps = {
  projectId: string
  run: AgentRun
  /** The newest run: reverting to it changes nothing, unless the project changed since. */
  latest: boolean
  /** The project changed after this reply (a revert or a manual edit), so it can be brought back. */
  changedSince: boolean
  /** Another run is active: restoring is not allowed meanwhile. */
  locked: boolean
  onRestored: () => void
}

/** Replies that didn't simply finish say why; a finished one needs no label. */
const STATUS: Record<string, string> = {
  failed: 'Stopped by an error',
  aborted: 'Stopped',
  interrupted: 'Paused',
}

const iconButton =
  'grid h-7 w-7 place-items-center rounded-full transition-colors hover:bg-ink/[0.06] hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent'

/** Under each finished reply, unboxed: revert / undo (icons) and the credits the reply cost. */
export function ReplyActions({
  projectId,
  run,
  latest,
  changedSince,
  locked,
  onRestored,
}: ReplyActionsProps) {
  const [confirm, setConfirm] = useState<'before' | 'after' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const canUndo = Boolean(run.checkpoint_before) && (run.files_changed ?? 0) > 0
  const canRevert = Boolean(run.checkpoint_after) && (!latest || changedSince)
  const credits = run.credits_used
  const status = STATUS[run.status]
  const undoLabel = latest ? 'Undo latest edit' : 'Undo this edit and the ones after it'
  // Whole credits are charged as usage adds up, so a small reply can cost "less than 1".
  const cost =
    credits > 0
      ? `${credits.toLocaleString('en-US')} credit${credits === 1 ? '' : 's'} used`
      : 'Less than 1 credit used'

  const restore = async (point: 'before' | 'after') => {
    setBusy(true)
    setError('')
    try {
      await restoreToCheckpoint({ data: { projectId, runId: run.id, point } })
      setConfirm(null)
      onRestored()
    } catch (err) {
      setError(toErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (confirm) {
    return (
      <div
        role="alertdialog"
        aria-label="Confirm restore"
        className="flex flex-wrap items-center gap-2 text-xs"
      >
        <span className="text-dim">
          {confirm === 'after' ? 'Revert to this version?' : `${undoLabel}?`} You can undo this too.
        </span>
        <span className="ml-auto flex gap-1">
          <button
            type="button"
            autoFocus
            disabled={busy}
            onClick={() => setConfirm(null)}
            className="rounded-full px-2.5 py-1 font-medium text-dim hover:bg-ink/[0.06] hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void restore(confirm)}
            className="inline-flex btn-sculpted items-center gap-1.5 rounded-full px-3 py-1 font-semibold"
          >
            {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
            {confirm === 'after' ? (busy ? 'Reverting…' : 'Revert') : busy ? 'Undoing…' : 'Undo'}
          </button>
        </span>
        {error && <p className="w-full text-danger">{error}</p>}
      </div>
    )
  }

  return (
    <div
      role="group"
      aria-label="Reply actions"
      className="-ml-1.5 flex items-center text-xs text-faint"
    >
      {canRevert && (
        <button
          type="button"
          disabled={locked}
          onClick={() => setConfirm('after')}
          aria-label="Revert to this version"
          title={locked ? 'Stop the agent first' : 'Revert to this version'}
          className={iconButton}
        >
          <History className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
      {canUndo && (
        <button
          type="button"
          disabled={locked}
          onClick={() => setConfirm('before')}
          aria-label={undoLabel}
          title={locked ? 'Stop the agent first' : undoLabel}
          className={iconButton}
        >
          <Undo2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
      <span title={cost} className="inline-flex items-center gap-1 px-1.5 tabular-nums">
        <Coins className="h-3.5 w-3.5" aria-hidden />
        <span aria-hidden>{credits > 0 ? credits.toLocaleString('en-US') : '<1'}</span>
        <span className="sr-only">{cost}</span>
      </span>
      {status && <span className="px-1.5">{status}</span>}
    </div>
  )
}
