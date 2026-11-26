import { useState, type FormEvent } from 'react'
import {
  AlertTriangle,
  ExternalLink,
  Loader2,
  Monitor,
  RotateCw,
  Smartphone,
  Tablet,
} from 'lucide-react'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/utils/cn'
import type { Project } from '../types'

export type PreviewDevice = 'desktop' | 'tablet' | 'mobile'

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

const roundButton =
  'grid h-9 w-9 shrink-0 place-items-center rounded-full text-dim transition-colors hover:bg-ink/[0.06] hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent md:pointer-fine:h-8 md:pointer-fine:w-8'

/** Preview state shared by the header controls and the frame. */
export function usePreview(project: Project) {
  const url = project.status === 'ready' ? project.preview_url : null
  const [device, setDevice] = useState<PreviewDevice>('desktop')
  const [path, setPath] = useState('/')
  const [draft, setDraft] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)
  return {
    url,
    device,
    setDevice,
    path,
    draft: draft ?? path.replace(/^\/+/, ''),
    editPath: setDraft,
    cancelEdit: () => setDraft(null),
    go: (next: string) => {
      const clean = `/${next.trim().replace(/^\/+/, '')}`
      setPath(clean)
      setDraft(null)
      setReloads((n) => n + 1)
    },
    reloads,
    reload: () => setReloads((n) => n + 1),
  }
}
export type Preview = ReturnType<typeof usePreview>

const href = (url: string, path: string) => new URL(path, url).toString()

/** Device size, page path (with reload) and "open in new tab". */
export function PreviewControls({ preview }: { preview: Preview }) {
  const ready = Boolean(preview.url)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    preview.go(preview.draft)
  }
  return (
    <div
      role="toolbar"
      aria-label="Preview controls"
      className="flex min-w-0 flex-1 items-center gap-1"
    >
      <div
        role="radiogroup"
        aria-label="Preview size"
        className="hidden shrink-0 items-center gap-0.5 rounded-full border bg-raised p-0.5 sm:flex"
      >
        {DEVICES.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={preview.device === id}
            aria-label={label}
            title={label}
            disabled={!ready}
            onClick={() => preview.setDevice(id)}
            className={cn(
              'grid h-8 w-8 place-items-center rounded-full transition-colors disabled:opacity-40 md:pointer-fine:h-7 md:pointer-fine:w-7',
              preview.device === id ? 'bg-ink/[0.09] text-ink' : 'text-dim hover:text-ink',
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
          </button>
        ))}
      </div>
      <form
        onSubmit={submit}
        className="mx-auto flex h-9 min-w-0 flex-1 items-center rounded-full border bg-raised pr-3 pl-1 font-mono text-xs text-dim transition-colors focus-within:border-signal/60 focus-within:text-ink md:max-w-[26rem] md:pointer-fine:h-8"
      >
        <button
          type="button"
          onClick={preview.reload}
          disabled={!ready}
          aria-label="Reload preview"
          title="Reload preview"
          className={roundButton + ' !h-7 !w-7'}
        >
          <RotateCw className="h-3.5 w-3.5" />
        </button>
        <label htmlFor="preview-path" className="sr-only">
          Page path
        </label>
        <span aria-hidden className="ml-1 text-faint select-none">
          /
        </span>
        <input
          id="preview-path"
          value={preview.draft}
          disabled={!ready}
          onChange={(e) => preview.editPath(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={preview.cancelEdit}
          onKeyDown={(e) => e.key === 'Escape' && preview.cancelEdit()}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          inputMode="url"
          enterKeyHint="go"
          placeholder="page"
          className="h-full min-w-0 flex-1 truncate bg-transparent px-0.5 outline-none placeholder:text-faint/60 disabled:opacity-50"
        />
      </form>
      {preview.url ? (
        <a
          href={href(preview.url, preview.path)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open in a new tab"
          title="Open in a new tab"
          className={roundButton}
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      ) : (
        <span aria-hidden className={roundButton + ' opacity-40'}>
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
  reloadSignal,
  retrying,
  onRetry,
}: {
  project: Project
  preview: Preview
  /** Changes when the preview should reload (a run finished, a restore, a manual save). */
  reloadSignal: number
  retrying: boolean
  onRetry: () => void
}) {
  const [loaded, setLoaded] = useState<string | null>(null)
  const width = DEVICES.find((d) => d.id === preview.device)?.width ?? null
  const frameKey = `${reloadSignal}:${preview.reloads}:${preview.path}`

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
          src={href(preview.url, preview.path)}
          title={`${project.name} preview`}
          onLoad={() => setLoaded(frameKey)}
          className="block h-full w-full border-0 bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
        />
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
  )
}

function CenteredState({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="grid h-full place-items-center p-6 text-center">
      <div className="flex flex-col items-center">{children}</div>
    </div>
  )
}
