import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import type { ProjectMode } from '~/features/projects'
import { useDismiss } from '~/hooks/use-dismiss'
import { cn } from '~/lib/utils/cn'

const MODES: Array<{ id: ProjectMode; label: string; description: string }> = [
  { id: 'build', label: 'Build', description: 'Make changes directly' },
  {
    id: 'chat',
    label: 'Chat',
    description: 'Ask anything, explore ideas. Nothing in your project changes.',
  },
]

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** ⌥P / Alt+P switches modes (keyboard `code`, so it works on any layout and never types "π"). */
export const isModeShortcut = (e: {
  altKey: boolean
  code: string
  ctrlKey: boolean
  metaKey: boolean
}) => e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyP'

export const nextMode = (mode: ProjectMode): ProjectMode => (mode === 'build' ? 'chat' : 'build')

/**
 * The composer's mode chip, next to Send, and its menu (opens upwards from the right, as the
 * composer sits at the bottom).
 */
export function ModeMenu({
  mode,
  disabled,
  onChange,
}: {
  mode: ProjectMode
  disabled?: boolean
  onChange: (mode: ProjectMode) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const items = useRef<Array<HTMLButtonElement | null>>([])
  const current = MODES.find((m) => m.id === mode) ?? MODES[0]!

  useDismiss(open, setOpen, root, trigger)
  // Opening focuses the current mode, for arrow keys.
  useEffect(() => {
    if (open) items.current[MODES.findIndex((m) => m.id === mode)]?.focus()
  }, [open, mode])

  const choose = (next: ProjectMode) => {
    setOpen(false)
    trigger.current?.focus()
    if (next !== mode) onChange(next)
  }

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Mode: ${current.label}. Change mode`}
        title={`${current.label} mode`}
        className={cn(
          'inline-flex h-8 items-center gap-1 rounded-full border pr-2 pl-3 text-[13px] font-medium text-ink transition-colors hover:bg-ink/[0.06] disabled:cursor-not-allowed disabled:opacity-50',
          open && 'bg-ink/[0.06]',
        )}
      >
        {current.label}
        <ChevronDown
          className={cn('h-3.5 w-3.5 text-dim transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Mode"
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
            e.preventDefault()
            const at = items.current.findIndex((el) => el === document.activeElement)
            const step = e.key === 'ArrowDown' ? 1 : -1
            items.current[(at + step + MODES.length) % MODES.length]?.focus()
          }}
          className="absolute right-0 bottom-full z-20 mb-2 w-64 rise rounded-2xl border bg-raised p-1.5 shadow-xl"
        >
          {MODES.map((m, i) => (
            <button
              key={m.id}
              ref={(el) => {
                items.current[i] = el
              }}
              type="button"
              role="menuitemradio"
              aria-checked={m.id === mode}
              onClick={() => choose(m.id)}
              className="flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left transition-colors outline-none hover:bg-ink/[0.06] focus-visible:bg-ink/[0.06]"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">{m.label}</span>
                <span className="block text-xs text-dim">{m.description}</span>
              </span>
              {m.id === mode && (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-signal" aria-hidden />
              )}
            </button>
          ))}
          <p className="mt-1 flex items-center gap-1 border-t px-3 pt-2 pb-1 text-[11px] text-faint">
            Switch modes with
            <kbd className="rounded border px-1 font-mono text-[10px] text-dim">
              {isMac() ? '⌥' : 'Alt'}
            </kbd>
            <kbd className="rounded border px-1 font-mono text-[10px] text-dim">P</kbd>
          </p>
        </div>
      )}
    </div>
  )
}
