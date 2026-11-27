import { useState, type ReactNode, type RefObject } from 'react'
import { AlertTriangle, ExternalLink, Loader2, Monitor, Smartphone, Tablet } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/utils/cn'
import { toPath } from '../lib/site-pages'
import type { Project } from '../types'
import { PagePicker } from './page-picker'

type PreviewDevice = 'desktop' | 'tablet' | 'mobile'

const DEVICES: Array<{
  id: PreviewDevice
  label: string
  Icon: typeof Monitor
  width: number | null
}> = [
  { id: 'desktop', label: 'Desktop', Icon: Monitor, width: null },
  { id: 'tablet', label: 'Tablet', Icon: Tablet, width: 768 },
  { id: 'mobile', label: 'Phone', Icon: Smartphone, width: 390 },
]

// Without `display`, so each button picks its own (grid, or hidden on phones).
const roundButton =
  'h-9 w-9 shrink-0 place-items-center rounded-full text-dim transition-colors hover:bg-ink/[0.06] hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent md:pointer-fine:h-8 md:pointer-fine:w-8'

/** Preview state shared by the header controls and the frame. */
export function usePreview(project: Project) {
  const url = project.status === 'ready' ? project.preview_url : null
  const [device, setDevice] = useState<PreviewDevice>('desktop')
  const [path, setPath] = useState('/')
  // Where the page actually is (the editor bridge reports link clicks inside the preview).
  const [current, setCurrent] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)
  return {
    url,
    device,
    setDevice,
    /** The page the frame was opened at (changing it reloads the frame). */
    path,
    /** The page shown right now. */
    shownPath: current ?? path,
    observe: setCurrent,
    go: (next: string) => {
      setPath(toPath(next))
      setCurrent(null)
      setReloads((n) => n + 1)
    },
    reloads,
    /** Reloads the page that's shown (where the user clicked to, if anywhere). */
    reload: () => {
      if (current) setPath(current)
      setCurrent(null)
      setReloads((n) => n + 1)
    },
  }
}
export type Preview = ReturnType<typeof usePreview>

const href = (url: string, path: string) => new URL(path, url).toString()

/** Device size (one button: desktop → tablet → phone), the path bar and "open in new tab". */
export function PreviewControls({ projectId, preview }: { projectId: string; preview: Preview }) {
  const ready = Boolean(preview.url)
  const at = Math.max(
    0,
    DEVICES.findIndex((d) => d.id === preview.device),
  )
  const current = DEVICES[at]!
  const next = DEVICES[(at + 1) % DEVICES.length]!
  return (
    <div
      role="toolbar"
      aria-label="Preview controls"
      className="flex w-full min-w-0 items-center gap-1"
    >
      <button
        type="button"
        onClick={() => preview.setDevice(next.id)}
        disabled={!ready}
        aria-label={`${current.label} view. Switch to ${next.label.toLowerCase()} view`}
        title={`${current.label} view · click for ${next.label.toLowerCase()}`}
        className={'hidden sm:grid ' + roundButton}
      >
        <current.Icon className="h-4 w-4" aria-hidden />
      </button>
      <PagePicker
        projectId={projectId}
        path={preview.shownPath}
        disabled={!ready}
        onGo={preview.go}
        onReload={preview.reload}
      />
      {preview.url ? (
        <a
          href={href(preview.url, preview.shownPath)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open in a new tab"
          title="Open in a new tab"
          className={'grid ' + roundButton}
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      ) : (
        <span aria-hidden className={'grid opacity-40 ' + roundButton}>
          <ExternalLink className="h-4 w-4" />
        </span>
      )}
    </div>
  )
}

/** The site in a frame (sized to the chosen device), or the setup state while it isn't ready. */
export function PreviewFrame({
  project,
  preview,
  frameKey,
  frameRef,
  onFrameLoad,
  frameOverlay,
  overlay,
  retrying,
  onRetry,
}: {
  project: Project
  preview: Preview
  /** Changes whenever the frame must reload (a run finished, a restore, reload, a new path). */
  frameKey: string
  frameRef: RefObject<HTMLIFrameElement | null>
  onFrameLoad: () => void
  /** Laid exactly over the page itself (the drawing layer). */
  frameOverlay?: ReactNode
  /** Floating editing tools over the preview area. */
  overlay?: ReactNode
  retrying: boolean
  onRetry: () => void
}) {
  const [loaded, setLoaded] = useState<string | null>(null)
  const width = DEVICES.find((d) => d.id === preview.device)?.width ?? null

  if (!preview.url) {
    return project.status === 'failed' ? (
      <CenteredState>
        <AlertTriangle className="h-7 w-7 text-danger" aria-hidden />
        <p className="mt-4 font-display text-xl font-bold">Setup failed</p>
        <p className="mt-1 max-w-sm text-sm text-dim">
          {project.error ?? 'The sandbox could not be set up.'}
        </p>
        <Button onClick={onRetry} loading={retrying} className="mt-6 w-auto px-6">
          Try again
        </Button>
      </CenteredState>
    ) : (
      <CenteredState>
        <Loader2 className="h-7 w-7 animate-spin text-signal" aria-hidden />
        <p className="mt-4 font-display text-xl font-bold">Setting up your sandbox</p>
        <p className="mt-1 max-w-sm text-sm text-dim">
          Installing the starter app and starting the preview. This takes a few seconds.
        </p>
      </CenteredState>
    )
  }

  return (
    <div className="relative h-full min-h-0">
      <section
        aria-label="Site preview"
        className={cn(
          'relative h-full min-h-0',
          width ? 'overflow-auto bg-sidebar p-3 sm:p-5' : 'overflow-hidden',
        )}
      >
        <div
          className={cn(
            'relative mx-auto h-full transition-[width] duration-300',
            width !== null &&
              'overflow-hidden rounded-2xl shadow-[0_20px_60px_-20px_rgb(0_0_0/0.8)] ring-1 ring-white/15',
          )}
          style={{ width: width ?? '100%', maxWidth: '100%' }}
        >
          <iframe
            key={frameKey}
            ref={frameRef}
            src={href(preview.url, preview.path)}
            title={`${project.name} preview`}
            onLoad={() => {
              setLoaded(frameKey)
              onFrameLoad()
            }}
            className="block h-full w-full border-0 bg-white"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
          />
          {frameOverlay}
          {loaded !== frameKey && (
            <div
              className="pointer-events-none absolute inset-0 grid place-items-center bg-paper/50"
              aria-hidden
            >
              <Loader2 className="h-6 w-6 animate-spin text-dim" />
            </div>
          )}
        </div>
      </section>
      {overlay}
    </div>
  )
}

function CenteredState({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="grid h-full place-items-center p-6 text-center">
      <div className="flex flex-col items-center">{children}</div>
    </div>
  )
}
