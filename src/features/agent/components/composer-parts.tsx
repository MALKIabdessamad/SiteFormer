/**
 * What sits on top of the message box: one-click next steps, and messages waiting for the agent.
 */
import { Clock, PencilLine, Trash2 } from 'lucide-react'
import type { QueuedMessage } from '../hooks/use-composer'
import { splitReferences } from '../lib/references'

/** Next steps offered for the last reply (a click sends one). */
export function Suggestions({
  suggestions,
  disabled,
  onPick,
}: {
  suggestions: Array<string>
  disabled: boolean
  onPick: (suggestion: string) => void
}) {
  if (suggestions.length === 0) return null
  return (
    <div
      aria-label="Suggested next steps"
      className="-mx-3 mb-2 no-scrollbar flex gap-1.5 overflow-x-auto [mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-12px),transparent)] px-3"
    >
      {suggestions.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          onClick={() => onPick(suggestion)}
          disabled={disabled}
          title={suggestion}
          className="h-8 max-w-[16rem] shrink-0 truncate rounded-full border bg-raised px-3 text-xs text-dim transition-colors hover:border-signal/50 hover:text-ink disabled:opacity-50"
        >
          {suggestion}
        </button>
      ))}
    </div>
  )
}

/** Messages sent while the agent works: they go one by one. Each can be edited or cancelled. */
export function QueuedMessages({
  queue,
  onEdit,
  onCancel,
}: {
  queue: Array<QueuedMessage>
  /** Back into the message box. */
  onEdit: (item: QueuedMessage) => void
  /** Deleted. */
  onCancel: (item: QueuedMessage) => void
}) {
  if (queue.length === 0) return null
  return (
    <ul aria-label="Queued messages" className="mb-2 space-y-1">
      {queue.map((item) => {
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
              onClick={() => onEdit(item)}
              aria-label="Edit this message"
              title="Edit"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-faint hover:bg-ink/[0.06] hover:text-ink"
            >
              <PencilLine className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => onCancel(item)}
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
  )
}
