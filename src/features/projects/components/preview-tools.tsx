import { useEffect, useRef, type ReactNode } from 'react'
import {
  Loader2,
  MousePointer2,
  Pencil,
  PencilRuler,
  TriangleAlert,
  Type,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '~/lib/utils/cn'
import type { EditorTool, Stroke, VisualEditor } from '../hooks/use-visual-editor'

/** The drawing's color (the AI gets the same lines on its screenshot). */
const INK = '#f43f5e'

const round =
  'grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 md:pointer-fine:h-8 md:pointer-fine:w-8'

/** The header button that opens and closes the editing tools (closed by default). */
export function ToolsToggle({ editor, disabled }: { editor: VisualEditor; disabled: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={editor.open}
      aria-label="Editing tools"
      title="Editing tools"
      disabled={disabled}
      onClick={editor.toggle}
      className={cn(
        round,
        editor.open
          ? 'btn-sculpted'
          : 'text-dim hover:bg-ink/[0.06] hover:text-ink disabled:hover:bg-transparent',
      )}
    >
      <PencilRuler className="h-4 w-4" aria-hidden />
    </button>
  )
}

const TOOLS: Array<{ id: EditorTool; label: string; icon: LucideIcon }> = [
  { id: 'select', label: 'Select elements for the chat', icon: MousePointer2 },
  { id: 'text', label: 'Edit text', icon: Type },
  { id: 'draw', label: 'Draw on the page', icon: Pencil },
]

/** The tools bar over the preview (while open) with its hints, and the page-error card. */
export function PreviewTools({
  editor,
  agentBusy,
  pickCount,
}: {
  editor: VisualEditor
  agentBusy: boolean
  pickCount: number
}) {
  const { tool, busy } = editor
  const starting = tool !== null && !editor.bridge.connected && !editor.stalled
  const hint =
    busy === 'capturing'
      ? 'Adding your drawing to the message…'
      : busy === 'saving'
        ? 'Saving your text…'
        : tool === null
          ? 'Pick a tool, then use it on the page.'
          : starting
            ? 'Starting the tools…'
            : editor.stalled
              ? null
              : tool === 'text'
                ? editor.editing
                  ? 'Type, then press Enter to save · Esc to cancel'
                  : 'Click any text on the page to edit it.'
                : tool === 'select'
                  ? pickCount
                    ? null
                    : 'Click elements to add them to your message.'
                  : editor.strokes.length
                    ? null
                    : 'Draw on the page to show what you mean.'

  return (
    <>
      {editor.error && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-3">
          <div
            role="alert"
            className="pointer-events-auto w-full max-w-md rise rounded-2xl border bg-raised/95 p-3 shadow-xl backdrop-blur"
          >
            <div className="flex items-start gap-2.5">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-dim" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">This page hit an error</p>
                <p
                  className="mt-0.5 line-clamp-2 font-mono text-[11px] break-words text-faint"
                  title={editor.error.message}
                >
                  {editor.error.message}
                </p>
              </div>
            </div>
            <div className="mt-2.5 flex justify-end gap-1">
              <button
                type="button"
                onClick={editor.dismissError}
                className="h-8 rounded-full px-3 text-xs font-medium text-dim hover:bg-ink/[0.06] hover:text-ink"
              >
                Dismiss
              </button>
              <button
                type="button"
                onClick={editor.fix}
                className="h-8 btn-sculpted rounded-full px-3.5 text-xs font-semibold"
              >
                Fix it
              </button>
            </div>
          </div>
        </div>
      )}

      {editor.open && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex flex-col items-center gap-2 px-3">
          {editor.notice && (
            <div className="pointer-events-auto flex w-full max-w-md rise items-start gap-2 rounded-2xl border bg-raised/95 p-2 pl-3.5 shadow-xl backdrop-blur">
              <p role="status" className="min-w-0 flex-1 py-1.5 text-xs text-dim">
                {editor.notice.message}
              </p>
              {editor.notice.retry && (
                <button
                  type="button"
                  onClick={editor.askInstead}
                  className="h-8 shrink-0 btn-sculpted rounded-full px-3 text-xs font-semibold"
                >
                  Ask AI
                </button>
              )}
              <button
                type="button"
                onClick={editor.dismissNotice}
                aria-label="Dismiss"
                className={cn(round, 'text-faint hover:bg-ink/[0.06] hover:text-ink')}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          )}

          <div
            role="toolbar"
            aria-label="Editing tools"
            className="pointer-events-auto flex items-center gap-0.5 rounded-full border bg-raised/95 p-1 shadow-lg backdrop-blur"
          >
            {TOOLS.map(({ id, label, icon: Icon }) => {
              const locked = id === 'text' && agentBusy
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={tool === id}
                  aria-label={label}
                  title={locked ? 'Edit text when the agent is done' : label}
                  disabled={locked}
                  onClick={() => editor.choose(id)}
                  className={cn(
                    round,
                    tool === id
                      ? 'bg-signal text-signal-ink'
                      : 'text-dim hover:bg-ink/[0.06] hover:text-ink disabled:hover:bg-transparent',
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                </button>
              )
            })}
            <span aria-hidden className="mx-0.5 h-5 w-px bg-ink/15" />
            <button
              type="button"
              onClick={editor.close}
              aria-label="Close the editing tools"
              title="Close"
              className={cn(round, 'text-dim hover:bg-ink/[0.06] hover:text-ink')}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>

          <div aria-live="polite" className="contents">
            {hint && <Hint spinner={busy !== null || starting}>{hint}</Hint>}
            {editor.stalled && (
              <Hint>
                The tools didn’t start in this page.
                <HintButton onClick={editor.reload}>Reload preview</HintButton>
              </Hint>
            )}
            {tool === 'select' && pickCount > 0 && busy === null && (
              <Hint>
                {pickCount === 1 ? '1 element' : `${pickCount} elements`} in your message
                <HintButton onClick={editor.showChat}>Write message</HintButton>
              </Hint>
            )}
            {tool === 'draw' && editor.strokes.length > 0 && busy === null && (
              <Hint>
                <HintButton onClick={editor.undoStroke}>
                  <Undo2 className="h-3 w-3" aria-hidden /> Undo
                </HintButton>
                <HintButton onClick={editor.clearStrokes}>Clear</HintButton>
                <button
                  type="button"
                  onClick={() => void editor.attachDrawing()}
                  className="h-6 btn-sculpted rounded-full px-2.5 font-semibold"
                >
                  Add to chat
                </button>
              </Hint>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function Hint({ children, spinner = false }: { children: ReactNode; spinner?: boolean }) {
  return (
    <p className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-paper/85 px-3 py-1 text-center text-xs text-dim backdrop-blur">
      {spinner && <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />}
      {children}
    </p>
  )
}

function HintButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-6 items-center gap-1 rounded-full px-2 font-medium text-ink hover:bg-ink/[0.08]"
    >
      {children}
    </button>
  )
}

/** Wheel and trackpad deltas in pixels (some browsers report lines or pages). */
function wheelPixels(e: React.WheelEvent<HTMLElement>): [number, number] {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? e.currentTarget.clientHeight : 1
  return [Math.round(e.deltaX * unit), Math.round(e.deltaY * unit)]
}

/**
 * The drawing surface, laid exactly over the page (same size and coordinates as the frame), so
 * each point is where it was drawn on the visible page.
 */
export function DrawLayer({
  strokes,
  onStroke,
  onScroll,
  disabled,
}: {
  strokes: Array<Stroke>
  onStroke: (stroke: Stroke) => void
  /** The wheel over the drawing scrolls the page underneath. */
  onScroll: (x: number, y: number) => void
  disabled: boolean
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const current = useRef<Stroke | null>(null)

  const paint = () => {
    const el = canvas.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return
    const scale = el.width / Math.max(1, el.clientWidth)
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    ctx.clearRect(0, 0, el.clientWidth, el.clientHeight)
    ctx.strokeStyle = INK
    ctx.lineWidth = 4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const stroke of current.current ? [...strokes, current.current] : strokes) {
      const [x0, y0] = stroke[0]!
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      if (stroke.length === 1) ctx.lineTo(x0 + 0.1, y0) // a dot
      for (const [x, y] of stroke.slice(1)) ctx.lineTo(x, y)
      ctx.stroke()
    }
  }
  const paintLatest = useRef(paint)
  useEffect(() => {
    paintLatest.current = paint
    paint()
  })

  // Sharp on high-density screens, and redrawn whenever the frame changes size.
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const fit = () => {
      const ratio = window.devicePixelRatio || 1
      el.width = Math.round(el.clientWidth * ratio)
      el.height = Math.round(el.clientHeight * ratio)
      paintLatest.current()
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const point = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect()
    return [Math.round(e.clientX - rect.left), Math.round(e.clientY - rect.top)]
  }
  const finish = () => {
    const stroke = current.current
    current.current = null
    if (stroke) onStroke(stroke)
  }

  return (
    <canvas
      ref={canvas}
      aria-label="Drawing area"
      className={cn(
        'absolute inset-0 z-10 h-full w-full cursor-crosshair touch-none',
        disabled && 'pointer-events-none',
      )}
      onWheel={(e) => onScroll(...wheelPixels(e))}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        current.current = [point(e)]
        paint()
      }}
      onPointerMove={(e) => {
        const stroke = current.current
        if (!stroke) return
        const [x, y] = point(e)
        const [px, py] = stroke[stroke.length - 1]!
        if (Math.abs(x - px) + Math.abs(y - py) < 3) return // fewer points, same line
        stroke.push([x, y])
        paint()
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
    />
  )
}
