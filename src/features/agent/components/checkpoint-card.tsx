import { useState } from 'react'
import { History, Loader2, RotateCcw } from 'lucide-react'
import { toErrorMessage } from '~/lib/utils/errors'
import { restoreToCheckpoint } from '../api/checkpoints.functions'
import type { AgentRun } from '../hooks/use-agent-runs'

type CheckpointCardProps = {
  projectId: string
  run: AgentRun
  /** The newest run: "restore to here" would change nothing, so only "undo" is offered. */
  latest: boolean
  /** Another run is active: restoring is not allowed meanwhile. */
  locked: boolean
  onRestored: () => void
}

const STATUS: Record<string, string> = {
  completed: 'Done',
  failed: 'Stopped by an error',
  aborted: 'Stopped',
  interrupted: 'Paused',
}

/** Shown after each finished reply: what changed, and one-click restore points. */
export function CheckpointCard({
  projectId,
  run,
  latest,
  locked,
  onRestored,
}: CheckpointCardProps) {
  const [confirm, setConfirm] = useState<'before' | 'after' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const changed = run.files_changed ?? 0
  const canUndo = Boolean(run.checkpoint_before) && changed > 0
  const canRestore = Boolean(run.checkpoint_after) && !latest

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

  return (
    <div className="mt-1 rounded-xl border bg-ink/[0.02] px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="flex items-center gap-1.5 text-faint">
          <History className="h-3.5 w-3.5" aria-hidden />
          {STATUS[run.status] ?? 'Finished'} ·{' '}
          {changed === 0 ? 'no file changes' : `${changed} file${changed === 1 ? '' : 's'} changed`}
          {run.credits_used > 0 &&
            ` · ${run.credits_used} credit${run.credits_used === 1 ? '' : 's'}`}
        </span>
        {!confirm && (canUndo || canRestore) && (
          <span className="ml-auto flex gap-1">
            {canRestore && (
              <button
                type="button"
                disabled={locked}
                onClick={() => setConfirm('after')}
                className="rounded-full px-2.5 py-1 font-medium text-dim transition-colors hover:bg-ink/[0.06] hover:text-ink disabled:opacity-40"
                title={
                  locked
                    ? 'Stop the agent first'
                    : 'Bring the project back to how it was right after this reply'
                }
              >
                Restore to here
              </button>
            )}
            {canUndo && (
              <button
                type="button"
                disabled={locked}
                onClick={() => setConfirm('before')}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium text-dim transition-colors hover:bg-ink/[0.06] hover:text-ink disabled:opacity-40"
                title={
                  locked
                    ? 'Stop the agent first'
                    : 'Bring the project back to how it was before this message'
                }
              >
                <RotateCcw className="h-3 w-3" aria-hidden /> Undo these changes
              </button>
            )}
          </span>
        )}
      </div>
      {confirm && (
        <div
          role="alertdialog"
          aria-label="Confirm restore"
          className="mt-2 flex flex-wrap items-center gap-2"
        >
          <span className="text-dim">
            {confirm === 'before'
              ? 'Undo everything from this message onward?'
              : 'Restore the project to right after this reply?'}{' '}
            You can undo a restore too.
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
              {busy ? 'Restoring…' : 'Restore'}
            </button>
          </span>
        </div>
      )}
      {error && <p className="mt-1.5 text-danger">{error}</p>}
    </div>
  )
}
