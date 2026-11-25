import { useState } from 'react'
import { AlertTriangle, ExternalLink, Loader2, MessageSquare, RotateCw } from 'lucide-react'
import { Button } from '~/components/ui/button'
import type { Project } from '../types'

const iconButton =
  'grid h-9 w-9 shrink-0 place-items-center rounded-lg text-dim transition-colors hover:bg-ink/[0.06] hover:text-ink'

type PreviewPanelProps = {
  project: Project
  /** Changes when the preview should reload (a run finished, a restore happened). */
  reloadSignal: number
  retrying: boolean
  onRetry: () => void
  onShowChat: () => void
}

/** Live preview of the sandbox's dev server, or the setup state while it isn't ready. */
export function PreviewPanel({
  project,
  reloadSignal,
  retrying,
  onRetry,
  onShowChat,
}: PreviewPanelProps) {
  const [manualReloads, setReloadKey] = useState(0)
  const reloadKey = `${reloadSignal}:${manualReloads}`
  const url = project.status === 'ready' ? project.preview_url : null

  return (
    <section aria-label="Preview" className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-1 px-2">
        <button
          type="button"
          onClick={onShowChat}
          aria-label="Show chat"
          title="Show chat"
          className={iconButton + ' md:hidden'}
        >
          <MessageSquare className="h-4 w-4" />
        </button>
        <div className="mx-1 flex h-9 min-w-0 flex-1 items-center rounded-full border bg-ink/[0.03] px-4 font-mono text-xs text-dim">
          <span className="truncate">{url ? new URL(url).host : 'Preview'}</span>
        </div>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          disabled={!url}
          aria-label="Reload preview"
          title="Reload preview"
          className={iconButton + ' disabled:opacity-40'}
        >
          <RotateCw className="h-4 w-4" />
        </button>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            aria-label="Open preview in a new tab"
            title="Open in a new tab"
            className={iconButton}
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        ) : (
          <span className={iconButton + ' opacity-40'} aria-hidden>
            <ExternalLink className="h-4 w-4" />
          </span>
        )}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-paper md:rounded-[20px] md:border">
        {url ? (
          <iframe
            key={reloadKey}
            src={url}
            title={`${project.name} preview`}
            className="h-full w-full border-0 bg-white"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
          />
        ) : project.status === 'failed' ? (
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
