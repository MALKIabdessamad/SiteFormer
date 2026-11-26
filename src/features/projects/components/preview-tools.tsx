import { useRef, useState, type ReactNode } from 'react'
import {
  ALargeSmall,
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowUp,
  Baseline,
  Bold,
  ImageUp,
  Loader2,
  MapPin,
  MousePointer2,
  PaintBucket,
  Palette,
  Scan,
  SquareRoundCorner,
  TriangleAlert,
  Type,
  X,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '~/lib/utils/cn'
import type { VisualEditor } from '../hooks/use-visual-editor'
import type { ProjectMode } from '../lib/constants'
import type { ElementInfo } from '../lib/preview-bridge'
import { currentStyle, STYLE_OPTIONS, type StyleGroup } from '../lib/tailwind-classes'
import { ThemePanel } from './theme-panel'

const card =
  'pointer-events-auto w-full rise rounded-2xl border bg-raised/95 shadow-xl backdrop-blur'

/** The editing tools floating over the preview. */
export function PreviewTools({
  editor,
  projectId,
  mode,
  agentBusy,
  pinCount,
}: {
  editor: VisualEditor
  projectId: string
  mode: ProjectMode
  agentBusy: boolean
  pinCount: number
}) {
  const [themeOpen, setThemeOpen] = useState(false)
  const { tool, selected, bridge } = editor

  const choose = (next: 'select' | 'annotate') => {
    setThemeOpen(false)
    editor.setTool(tool === next ? 'none' : next)
  }

  const hint =
    tool === 'none'
      ? null
      : !bridge.connected
        ? 'Starting the editing tools…'
        : editor.editing
          ? 'Type, then press Enter to save · Esc to cancel'
          : editor.saving
            ? 'Saving…'
            : tool === 'annotate'
              ? pinCount
                ? `${pinCount} pinned · write each note in the chat box, then send`
                : 'Click things on the page to pin notes for the AI'
              : agentBusy
                ? 'The agent is working: direct edits wait until it’s done'
                : selected
                  ? selected.textEditable
                    ? 'Double-click text on the page to type over it'
                    : null
                  : 'Click something on the page to edit it'

  return (
    <>
      {editor.error && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-3">
          <div role="alert" className={cn(card, 'max-w-md p-3')}>
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

      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex flex-col items-center gap-2 px-3">
        {editor.notice && !(tool === 'select' && selected) && (
          <div className={cn(card, 'max-w-md p-2.5')}>
            <NoticeRow editor={editor} />
          </div>
        )}
        {tool === 'select' && selected && (
          <SelectionCard
            key={selected.loc}
            editor={editor}
            element={selected}
            mode={mode}
            agentBusy={agentBusy}
          />
        )}
        {themeOpen && (
          <ThemePanel
            projectId={projectId}
            disabled={agentBusy}
            onPreview={(vars) => bridge.post({ type: 'theme', vars })}
            onSaved={() => {
              setThemeOpen(false)
              editor.themeSaved()
            }}
            onClose={() => setThemeOpen(false)}
          />
        )}
        <div
          role="toolbar"
          aria-label="Preview editing tools"
          className="pointer-events-auto flex items-center gap-0.5 rounded-full border bg-raised/95 p-1 shadow-lg backdrop-blur"
        >
          <PillButton
            active={tool === 'select'}
            label="Select and edit"
            icon={MousePointer2}
            onClick={() => choose('select')}
          />
          <PillButton
            active={tool === 'annotate'}
            label="Pin notes for the AI"
            icon={MapPin}
            onClick={() => choose('annotate')}
            badge={pinCount || undefined}
          />
          <PillButton
            active={themeOpen}
            label="Theme colors"
            icon={Palette}
            onClick={() => {
              editor.setTool('none')
              setThemeOpen((open) => !open)
            }}
          />
          {(tool !== 'none' || themeOpen) && (
            <>
              <span aria-hidden className="mx-0.5 h-5 w-px bg-ink/15" />
              <button
                type="button"
                onClick={() => {
                  editor.setTool('none')
                  setThemeOpen(false)
                }}
                className="h-9 rounded-full px-3 text-xs font-medium text-dim transition-colors hover:bg-ink/[0.06] hover:text-ink md:pointer-fine:h-8"
              >
                Done
              </button>
            </>
          )}
        </div>
        {hint && (
          <p
            aria-live="polite"
            className="flex items-center gap-1.5 rounded-full bg-paper/80 px-3 py-1 text-center text-xs text-dim backdrop-blur"
          >
            {(editor.saving || !bridge.connected) && (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            )}
            {hint}
          </p>
        )}
      </div>
    </>
  )
}

function PillButton({
  active,
  label,
  icon: Icon,
  onClick,
  badge,
}: {
  active: boolean
  label: string
  icon: LucideIcon
  onClick: () => void
  badge?: number
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'relative grid h-9 w-9 place-items-center rounded-full transition-colors md:pointer-fine:h-8 md:pointer-fine:w-8',
        active ? 'bg-signal text-signal-ink' : 'text-dim hover:bg-ink/[0.06] hover:text-ink',
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {badge !== undefined && (
        <span className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-signal px-1 text-[10px] font-bold text-signal-ink ring-2 ring-raised">
          {badge}
        </span>
      )}
    </button>
  )
}

function NoticeRow({ editor }: { editor: VisualEditor }) {
  const notice = editor.notice
  if (!notice) return null
  const retry = notice.retry
  return (
    <div className="flex items-start gap-2 px-1">
      <p className="min-w-0 flex-1 py-1 text-xs text-dim">{notice.message}</p>
      {retry && (
        <button
          type="button"
          onClick={() =>
            editor.ask(retry.text, {
              element: retry.element,
              ...(retry.uploads && { uploads: retry.uploads }),
            })
          }
          className="h-7 shrink-0 btn-sculpted rounded-full px-3 text-xs font-semibold"
        >
          Ask AI
        </button>
      )}
      <button
        type="button"
        onClick={editor.dismissNotice}
        aria-label="Dismiss"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-faint hover:bg-ink/[0.06] hover:text-ink"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

const CONTROLS: Array<{ group: StyleGroup; label: string; icon: LucideIcon }> = [
  { group: 'textColor', label: 'Text color', icon: Baseline },
  { group: 'backgroundColor', label: 'Background', icon: PaintBucket },
  { group: 'fontSize', label: 'Font size', icon: ALargeSmall },
  { group: 'fontWeight', label: 'Font weight', icon: Bold },
  { group: 'textAlign', label: 'Alignment', icon: AlignCenter },
  { group: 'borderRadius', label: 'Corners', icon: SquareRoundCorner },
  { group: 'padding', label: 'Padding', icon: Scan },
]

function SelectionCard({
  editor,
  element,
  mode,
  agentBusy,
}: {
  editor: VisualEditor
  element: ElementInfo
  mode: ProjectMode
  agentBusy: boolean
}) {
  const [panel, setPanel] = useState<StyleGroup | null>(null)
  const [request, setRequest] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const locked = agentBusy || editor.editing
  const [path = '', line = ''] = element.loc.split(':')

  return (
    <div className={cn(card, 'max-w-[30rem] p-2')} role="group" aria-label="Selected element">
      <div className="flex items-center gap-2 pl-1.5 text-xs">
        <span className="shrink-0 rounded bg-ink/[0.08] px-1.5 py-0.5 font-mono text-ink">
          &lt;{element.tag}&gt;
        </span>
        <span className="min-w-0 flex-1 truncate text-dim">
          {element.text || (element.image !== null ? 'Image' : 'Element')}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-faint" title={element.loc}>
          {path.split('/').pop()}:{line}
        </span>
        <button
          type="button"
          onClick={editor.deselect}
          aria-label="Clear selection"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-faint hover:bg-ink/[0.06] hover:text-ink"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {editor.notice && (
        <div className="mt-1.5 rounded-xl bg-ink/[0.04] p-1.5">
          <NoticeRow editor={editor} />
        </div>
      )}

      <div
        role="toolbar"
        aria-label="Edit this element"
        className="mt-1.5 flex flex-wrap items-center gap-0.5"
      >
        {element.textEditable && (
          <ToolButton label="Edit text" icon={Type} disabled={locked} onClick={editor.editText} />
        )}
        {CONTROLS.map(({ group, label, icon }) => (
          <ToolButton
            key={group}
            label={label}
            icon={icon}
            disabled={locked}
            pressed={panel === group}
            onClick={() => setPanel(panel === group ? null : group)}
          />
        ))}
        {element.image !== null && (
          <>
            <ToolButton
              label="Replace image"
              icon={ImageUp}
              disabled={locked}
              onClick={() => file.current?.click()}
            />
            <input
              ref={file}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
              hidden
              onChange={(e) => {
                const picked = e.target.files?.[0]
                if (picked) editor.swapImage(element, picked)
                e.target.value = ''
              }}
            />
          </>
        )}
      </div>

      {panel && !locked && (
        <StylePanel
          group={panel}
          classes={element.classes}
          theme={editor.bridge.theme}
          onPick={(value) => editor.setElementStyle(panel, value)}
        />
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!request.trim()) return
          editor.ask(request, { element: editor.toRef(element) })
          setRequest('')
        }}
        className="mt-1.5 flex items-center rounded-xl border bg-paper/60 pl-3 transition-colors focus-within:border-signal/60"
      >
        <label htmlFor="element-request" className="sr-only">
          {mode === 'chat' ? 'Ask about this element' : 'Ask the AI to change this element'}
        </label>
        <input
          id="element-request"
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          maxLength={2000}
          autoComplete="off"
          placeholder={mode === 'chat' ? 'Ask about this…' : 'Ask AI to change this…'}
          className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
        />
        <button
          type="submit"
          disabled={!request.trim()}
          aria-label="Send to the AI"
          className="m-1 grid h-7 w-7 shrink-0 btn-sculpted place-items-center rounded-full disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  )
}

function ToolButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  pressed,
}: {
  label: string
  icon: LucideIcon
  onClick: () => void
  disabled?: boolean
  pressed?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid h-8 w-8 place-items-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        pressed ? 'bg-signal/15 text-signal' : 'text-dim hover:bg-ink/[0.06] hover:text-ink',
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  )
}

// Theme colors of the site itself (shown with the site's real values).
const TOKEN_SWATCH: Record<string, string> = {
  'text-foreground': 'foreground',
  'text-muted-foreground': 'muted-foreground',
  'text-primary': 'primary',
  'bg-background': 'background',
  'bg-muted': 'muted',
  'bg-primary': 'primary',
}
const TOKEN_NAME: Record<string, string> = {
  'text-foreground': 'Text',
  'text-muted-foreground': 'Muted text',
  'text-primary': 'Primary',
  'bg-background': 'Page background',
  'bg-muted': 'Muted',
  'bg-primary': 'Primary',
  'bg-transparent': 'None',
}

const words = (value: string) =>
  value
    .replace(/^(text|bg|font|rounded|p)-?/, '')
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ') || 'Default'

function StylePanel({
  group,
  classes,
  theme,
  onPick,
}: {
  group: StyleGroup
  classes: string
  theme: Record<string, string>
  onPick: (value: string | null) => void
}) {
  const current = currentStyle(classes, group)
  const options = STYLE_OPTIONS[group]
  const chip = (value: string | null, content: ReactNode, label: string) => (
    <button
      key={value ?? 'default'}
      type="button"
      onClick={() => onPick(value)}
      aria-label={label}
      title={label}
      aria-pressed={current === value}
      className={cn(
        'h-7 rounded-full px-2.5 text-xs transition-colors',
        current === value
          ? 'bg-signal/15 text-signal'
          : 'text-dim hover:bg-ink/[0.06] hover:text-ink',
      )}
    >
      {content}
    </button>
  )

  if (group === 'textColor' || group === 'backgroundColor') {
    return (
      <div className="mt-1.5 flex flex-wrap gap-1 rounded-xl bg-ink/[0.03] p-1.5">
        {options.map((value) => {
          const token = TOKEN_SWATCH[value]
          const label = TOKEN_NAME[value] ?? words(value)
          return (
            <button
              key={value}
              type="button"
              onClick={() => onPick(value)}
              aria-label={label}
              title={label}
              aria-pressed={current === value}
              className={cn(
                'grid h-7 w-7 place-items-center rounded-full transition-transform hover:scale-110',
                current === value && 'ring-2 ring-signal ring-offset-2 ring-offset-raised',
              )}
            >
              <span
                className={cn(
                  'block h-5 w-5 rounded-full ring-1 ring-white/20',
                  value === 'bg-transparent'
                    ? 'border border-dashed border-faint ring-0'
                    : token
                      ? null
                      : group === 'textColor'
                        ? cn('bg-current', value)
                        : value,
                )}
                style={token ? { background: theme[token] ?? 'transparent' } : undefined}
              />
            </button>
          )
        })}
      </div>
    )
  }

  if (group === 'textAlign') {
    const icons = { 'text-left': AlignLeft, 'text-center': AlignCenter, 'text-right': AlignRight }
    return (
      <div className="mt-1.5 flex gap-1 rounded-xl bg-ink/[0.03] p-1.5">
        {options.map((value) => {
          const Icon = icons[value as keyof typeof icons]
          return chip(value, <Icon className="h-3.5 w-3.5" aria-hidden />, words(value))
        })}
      </div>
    )
  }

  return (
    <div className="mt-1.5 flex flex-wrap gap-0.5 rounded-xl bg-ink/[0.03] p-1.5">
      {chip(null, 'Default', 'Default')}
      {options.map((value) =>
        chip(
          value,
          <span className={group === 'fontWeight' ? value : undefined}>{words(value)}</span>,
          words(value),
        ),
      )}
    </div>
  )
}
