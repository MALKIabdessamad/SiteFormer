import { useState, type ReactNode } from 'react'
import type { Composer, SendOptions } from '~/features/agent'
import type { Account } from '~/features/billing'
import { Code2, Eye } from 'lucide-react'
import { cn } from '~/lib/utils/cn'
import type { Project } from '../types'
import { CodePanel } from './code-panel'
import { useVisualEditor } from '../hooks/use-visual-editor'
import { PreviewControls, PreviewFrame, usePreview } from './preview-panel'
import { DrawLayer, PreviewTools, ToolsToggle } from './preview-tools'
import { PublishButton } from './publish-button'

type Tab = 'preview' | 'code'

// MCPs and project settings join these later.
const TABS: Array<{ id: Tab; label: string; Icon: typeof Eye }> = [
  { id: 'preview', label: 'Preview', Icon: Eye },
  { id: 'code', label: 'Code', Icon: Code2 },
]

/**
 * The right side of a project: a header (chat toggle and view tabs on the left, preview controls
 * in the middle, the editing tools toggle and Publish on the right) over a card showing the
 * preview or the code. On small screens the preview controls wrap to a second row.
 */
export function ProjectPane({
  project,
  account,
  awake,
  agentBusy,
  building,
  reloadSignal,
  retrying,
  onRetry,
  onSaved,
  composer,
  onAsk,
  onVisualEdit,
  onShowChat,
  chatToggle,
}: {
  project: Project
  /** The user's plan and credits (null while loading). */
  account: Account | null
  /** The sandbox answered since the page opened (it may have been asleep). */
  awake: boolean
  agentBusy: boolean
  /** A build run is working: the preview shows its result when it's done. */
  building: boolean
  reloadSignal: number
  retrying: boolean
  onRetry: () => void
  /** A Code tab save: `note` is what the chat now ends with. */
  onSaved: (note: string) => void
  composer: Composer
  /** Sends a message to the AI (from the preview's editing tools). */
  onAsk: (text: string, options?: SendOptions) => void
  /** A direct edit in the preview was saved: `note` is what the chat now ends with. */
  onVisualEdit: (note: string) => void
  /** Brings the chat into view (phones show one panel at a time; desktop may have it collapsed). */
  onShowChat: () => void
  /** Buttons that bring the chat back (phone: switch view; desktop: reopen the collapsed chat). */
  chatToggle: ReactNode
}) {
  const [tab, setTab] = useState<Tab>('preview')
  const [codeOpened, setCodeOpened] = useState(false)
  const preview = usePreview(project, awake)
  const frameKey = `${reloadSignal}:${preview.reloads}:${preview.path}`
  const editor = useVisualEditor({
    projectId: project.id,
    preview,
    frameKey,
    composer,
    agentBusy,
    onAsk,
    onEdited: onVisualEdit,
    onShowChat,
  })

  const choose = (next: Tab) => {
    setTab(next)
    if (next === 'code') setCodeOpened(true)
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-2 py-2 lg:h-14 lg:flex-nowrap lg:py-0">
        {/* Both sides share the free space equally, so the preview controls sit in the middle. */}
        <div className="flex shrink-0 items-center gap-2 lg:flex-1 lg:basis-0">
          {chatToggle}
          <div
            role="tablist"
            aria-label="Project views"
            className="flex shrink-0 items-center gap-0.5 rounded-full border bg-raised p-0.5"
          >
            {TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => choose(id)}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors md:pointer-fine:h-7',
                  tab === id ? 'bg-signal/15 text-signal' : 'text-dim hover:text-ink',
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {label}
              </button>
            ))}
          </div>
        </div>
        {tab === 'preview' && (
          <div className="order-last flex w-full min-w-0 lg:order-none lg:w-auto">
            <PreviewControls projectId={project.id} preview={preview} />
          </div>
        )}
        <div className="ml-auto flex shrink-0 items-center justify-end gap-1.5 lg:ml-0 lg:flex-1 lg:basis-0">
          {tab === 'preview' && <ToolsToggle editor={editor} disabled={!preview.url} />}
          <PublishButton />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden border-t bg-paper md:rounded-[20px] md:border">
        <div className={cn('h-full', tab === 'preview' ? 'block' : 'hidden')}>
          <PreviewFrame
            project={project}
            preview={preview}
            frameKey={frameKey}
            frameRef={editor.bridge.frame}
            onFrameLoad={editor.bridge.hello}
            frameOverlay={
              editor.open &&
              editor.tool === 'draw' &&
              editor.bridge.connected && (
                <DrawLayer
                  strokes={editor.strokes}
                  onStroke={editor.addStroke}
                  onScroll={editor.scrollPage}
                  disabled={editor.busy !== null}
                />
              )
            }
            overlay={
              <>
                {building && <BuildingNote />}
                <PreviewTools
                  editor={editor}
                  agentBusy={agentBusy}
                  outOfCredits={account !== null && account.credits < 1}
                  picked={composer.picks[0]?.element.tag ?? null}
                />
              </>
            }
            retrying={retrying}
            onRetry={onRetry}
          />
        </div>
        {codeOpened && (
          <div className={cn('h-full', tab === 'code' ? 'block' : 'hidden')}>
            <CodePanel
              projectId={project.id}
              ready={project.status === 'ready'}
              agentBusy={agentBusy}
              canEdit={account !== null && account.plan !== 'free'}
              refreshSignal={reloadSignal}
              onSaved={onSaved}
            />
          </div>
        )}
      </div>
    </div>
  )
}

/** While the AI builds, the preview keeps the last version (no half-written pages or errors). */
function BuildingNote() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-3">
      <p
        role="status"
        className="flex items-center gap-2 rounded-full border bg-raised/90 px-3 py-1.5 text-xs text-dim shadow-lg backdrop-blur"
      >
        <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal" />
        The preview updates when the AI is done
      </p>
    </div>
  )
}
