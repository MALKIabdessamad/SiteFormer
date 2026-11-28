import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Loader2,
  MousePointer2,
  Pencil,
  PencilRuler,
  Redo2,
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
const quiet = 'text-dim hover:bg-ink/[0.06] hover:text-ink disabled:hover:bg-transparent'
const pill =
  'inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40'

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
      className={cn(round, editor.open ? 'btn-sculpted' : quiet)}
    >
      <PencilRuler className="h-4 w-4" aria-hidden />
    </button>
  )
}

const TOOLS: Array<{ id: EditorTool; label: string; icon: LucideIcon }> = [
  { id: 'select', label: 'Select an element for the chat', icon: MousePointer2 },
  { id: 'text', label: 'Edit text', icon: Type },
  { id: 'draw', label: 'Draw on the page', icon: Pencil },
]

/**
 * One card that changes with what you're doing (its width eases from one state to the next):
 * the tools, then the active tool with its actions, e.g. "1 text change · Cancel · Save".
 */
function MorphCard({ state, children }: { state: string; children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState<number>()
  useEffect(() => {
    const el = inner.current
    if (!el) return
    // + the 1px border on each side.
    const observer = new ResizeObserver(() => setWidth(el.offsetWidth + 2))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return (
    <div
      role="toolbar"
      aria-label="Editing tools"
      style={{ width }}
      className="pointer-events-auto max-w-full overflow-hidden rounded-[22px] border bg-raised/95 shadow-lg backdrop-blur transition-[width] duration-300 ease-out motion-reduce:transition-none"
    >
      <div ref={inner} className="w-max max-w-[calc(100vw-1.5rem)]">
        <div key={state} className="flex fade-in items-center gap-1 p-1">
          {children}
        </div>
      </div>
    </div>
  )
}

/** The active tool's icon; pressing it goes back to the tools. */
function ToolBadge({
  icon: Icon,
  onBack,
  label = 'Back to the tools',
}: {
  icon: LucideIcon
  onBack?: () => void
  label?: string
}) {
  return onBack ? (
    <button
      type="button"
      onClick={onBack}
      aria-label={label}
      title={label}
      className={cn(round, 'bg-signal text-signal-ink hover:brightness-110')}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  ) : (
    <span aria-hidden className={cn(round, 'bg-signal text-signal-ink')}>
      <Icon className="h-4 w-4" />
    </span>
  )
}

function Label({ children, spinner = false }: { children: ReactNode; spinner?: boolean }) {
  return (
    <span
      role="status"
      className="flex max-w-[16rem] min-w-0 items-center gap-1.5 px-1.5 text-xs text-dim"
    >
      {spinner && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />}
      <span className="min-w-0">{children}</span>
    </span>
  )
}

/** The editing tools over the preview (while open), and the page-error card. */
export function PreviewTools({
  editor,
  agentBusy,
  picked,
}: {
  editor: VisualEditor
  agentBusy: boolean
  /** The element picked for the chat (its tag), if any. */
  picked: string | null
}) {
  const { tool, busy, texts, notice } = editor
  const icon = TOOLS.find((t) => t.id === tool)?.icon ?? Type
  const starting = tool !== null && !editor.bridge.connected

  let state: string
  let content: ReactNode
  if (texts.length > 0 || busy === 'saving') {
    // Changed texts wait here until saved or cancelled.
    state = busy === 'saving' ? 'saving' : `texts:${agentBusy}:${notice?.message}`
    content =
      busy === 'saving' ? (
        <>
          <ToolBadge icon={Type} />
          <Label spinner>Saving…</Label>
        </>
      ) : (
        <>
          <ToolBadge icon={Type} />
          <Label>
            {notice
              ? notice.message
              : texts.length === 1
                ? '1 text change'
                : `${texts.length} text changes`}
          </Label>
          {notice && (
            <button
              type="button"
              onClick={editor.dismissNotice}
              aria-label="Dismiss"
              className={cn(round, quiet)}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
          <button
            type="button"
            onClick={editor.cancelTexts}
            className={cn(pill, 'border text-dim hover:bg-ink/[0.06] hover:text-ink')}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void editor.saveTexts()}
            disabled={agentBusy}
            title={agentBusy ? 'Save when the agent is done' : undefined}
            className={cn(pill, 'btn-sculpted')}
          >
            Save
          </button>
        </>
      )
  } else if (notice) {
    state = `notice:${notice.message}`
    content = (
      <>
        <ToolBadge icon={tool ? icon : Type} onBack={editor.back} />
        <Label>{notice.message}</Label>
        {notice.ask && (
          <button type="button" onClick={editor.askInstead} className={cn(pill, 'btn-sculpted')}>
            Ask AI
          </button>
        )}
        <button
          type="button"
          onClick={editor.dismissNotice}
          aria-label="Dismiss"
          className={cn(round, quiet)}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </>
    )
  } else if (tool === null) {
    state = 'tools'
    content = (
      <>
        {TOOLS.map(({ id, label, icon: Icon }) => {
          const locked = id === 'text' && agentBusy
          return (
            <button
              key={id}
              type="button"
              aria-pressed={false}
              aria-label={label}
              title={locked ? 'Edit text when the agent is done' : label}
              disabled={locked}
              onClick={() => editor.choose(id)}
              className={cn(round, quiet)}
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
          className={cn(round, quiet)}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </>
    )
  } else if (editor.stalled) {
    state = 'stalled'
    content = (
      <>
        <ToolBadge icon={icon} onBack={editor.back} />
        <Label>The tools didn’t start in this page.</Label>
        <button type="button" onClick={editor.reload} className={cn(pill, 'btn-sculpted')}>
          Reload
        </button>
      </>
    )
  } else if (starting) {
    state = 'starting'
    content = (
      <>
        <ToolBadge icon={icon} onBack={editor.back} />
        <Label spinner>Starting…</Label>
      </>
    )
  } else if (tool === 'select') {
    state = `select:${picked ?? ''}`
    content = (
      <>
        <ToolBadge icon={MousePointer2} onBack={editor.back} />
        <Label>{picked ? `<${picked}> is in your message` : 'Click an element'}</Label>
      </>
    )
  } else if (tool === 'text') {
    state = `text:${editor.editing}`
    content = (
      <>
        <ToolBadge icon={Type} onBack={editor.back} />
        <Label>
          {editor.editing ? 'Enter to keep it · Esc to undo' : 'Click any text to change it'}
        </Label>
      </>
    )
  } else if (busy === 'capturing') {
    state = 'capturing'
    content = (
      <>
        <ToolBadge icon={Pencil} />
        <Label spinner>Adding it to your message…</Label>
      </>
    )
  } else {
    const drawn = editor.strokes.length > 0
    state = 'draw'
    content = (
      <>
        <ToolBadge icon={Pencil} onBack={editor.back} />
        <Label>Annotation</Label>
        <button
          type="button"
          onClick={editor.undoStroke}
          disabled={!drawn}
          aria-label="Undo"
          title="Undo"
          className={cn(round, quiet)}
        >
          <Undo2 className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={editor.redoStroke}
          disabled={!editor.canRedo}
          aria-label="Redo"
          title="Redo"
          className={cn(round, quiet)}
        >
          <Redo2 className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={editor.clearStrokes}
          disabled={!drawn}
          className={cn(pill, 'border text-dim hover:bg-ink/[0.06] hover:text-ink')}
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => void editor.attachDrawing()}
          disabled={!drawn}
          className={cn(pill, 'btn-sculpted')}
        >
          Add to chat
        </button>
      </>
    )
  }

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

      {(editor.open || texts.length > 0) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3">
          <MorphCard state={state}>{content}</MorphCard>
        </div>
      )}
    </>
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
