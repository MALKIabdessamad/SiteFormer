import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { MessageSquare, PanelLeftOpen } from 'lucide-react'
import { Spinner } from '~/components/ui/spinner'
import { site } from '~/config/site'
import { isSettledRun, useAgentRuns, useComposer, type SendOptions } from '~/features/agent'
import { useRedirectOnSignOut } from '~/features/auth'
import { reportClientError } from '~/lib/report-error'
import { cn } from '~/lib/utils/cn'
import { toErrorMessage } from '~/lib/utils/errors'
import { deleteProject, openProject, retryProject } from '../api/projects.functions'
import { useProject } from '../hooks/use-projects'
import { ChatPanel } from './chat-panel'
import { ProjectPane } from './project-pane'

/** Workspace for one project: chat on the left; preview / code on the right. */
export function ProjectScreen({ projectId }: { projectId: string }) {
  const navigate = useNavigate()
  const { status, project, refresh } = useProject(projectId)
  const [mobileView, setMobileView] = useState<'chat' | 'project'>('chat')
  const [chatCollapsed, setChatCollapsed] = useState(false)
  const [chatBusy, setChatBusy] = useState(false)
  const [busy, setBusy] = useState<'retry' | 'delete' | null>(null)
  const [error, setError] = useState('')
  const { runs, activeRun, refresh: refreshRuns } = useAgentRuns(projectId)
  const [chatKey, setChatKey] = useState(0)
  const [previewKey, setPreviewKey] = useState(0)
  const composer = useComposer()

  useRedirectOnSignOut()

  // Reload the preview whenever a run settles (its changes are committed and in place).
  const finishedRuns = runs.filter(isSettledRun).length
  const seenFinished = useRef<number | null>(null)
  useEffect(() => {
    if (seenFinished.current !== null && finishedRuns > seenFinished.current)
      setPreviewKey((k) => k + 1)
    seenFinished.current = finishedRuns
  }, [finishedRuns])

  const reconnectChat = useCallback(() => setChatKey((k) => k + 1), [])

  // The preview tools talk to the AI through the chat (shown, so the user sees it go).
  const ask = (text: string, options?: SendOptions) => {
    setMobileView('chat')
    setChatCollapsed(false)
    void composer.send(text, options)
  }

  const afterRestore = useCallback(() => {
    setChatKey((k) => k + 1) // show the restore note
    setPreviewKey((k) => k + 1)
    void refreshRuns()
  }, [refreshRuns])

  // Tab title follows the live name (the AI renames the project a moment after creation).
  const name = project?.name
  useEffect(() => {
    if (name) document.title = `${name} · ${site.name}`
  }, [name])

  // Opening the page resumes an interrupted setup, or wakes a sleeping sandbox.
  useEffect(() => {
    openProject({ data: { projectId } }).catch((err: unknown) =>
      reportClientError('project', 'Opening the project failed', {
        projectId,
        detail: toErrorMessage(err),
      }),
    )
  }, [projectId])

  const retry = async () => {
    setBusy('retry')
    setError('')
    try {
      await retryProject({ data: { projectId } })
      await refresh() // show "Setting up" right away, without waiting for Realtime/polling
    } catch (err) {
      setError(toErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    setBusy('delete')
    setError('')
    try {
      await deleteProject({ data: { projectId } })
      await navigate({ to: '/dashboard', replace: true })
    } catch (err) {
      setError(toErrorMessage(err))
      setBusy(null)
    }
  }

  if (status === 'loading') {
    return (
      <main className="grid h-dvh place-items-center bg-paper">
        <Spinner label="Loading project" />
      </main>
    )
  }

  if (!project) {
    return (
      <main className="grid min-h-dvh place-items-center bg-paper px-5 text-center">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-[-0.03em]">
            {status === 'missing' ? 'Project not found' : 'Couldn’t load this project'}
          </h1>
          <p className="mt-2 text-dim">
            {status === 'missing'
              ? 'It may have been deleted, or it belongs to another account.'
              : 'Check your connection and try again.'}
          </p>
          <Link
            to="/dashboard"
            className="mt-6 inline-flex h-11 btn-sculpted items-center rounded-full px-6 text-sm font-semibold"
          >
            Back to dashboard
          </Link>
        </div>
      </main>
    )
  }

  const small =
    'grid h-9 w-9 shrink-0 place-items-center rounded-full text-dim transition-colors hover:bg-ink/[0.06] hover:text-ink'

  return (
    <div className="relative flex h-dvh min-h-0 overflow-clip bg-sidebar pt-[env(safe-area-inset-top)] text-ink md:p-2 md:pl-0">
      <div
        className={cn(
          'min-h-0 w-full flex-col md:w-[360px] md:shrink-0',
          mobileView === 'chat' ? 'flex' : 'hidden',
          chatCollapsed ? 'md:hidden' : 'md:flex',
        )}
      >
        <ChatPanel
          project={project}
          runs={runs}
          activeRun={activeRun}
          chatKey={chatKey}
          deleting={busy === 'delete'}
          onDelete={() => void remove()}
          onShowPreview={() => setMobileView('project')}
          onCollapse={() => setChatCollapsed(true)}
          onRestored={afterRestore}
          onConnectionLost={reconnectChat}
          onActivity={refreshRuns}
          onBusyChange={setChatBusy}
          onProjectChanged={refresh}
          composer={composer}
        />
      </div>
      <div
        className={cn(
          'min-h-0 min-w-0 flex-1 flex-col md:flex',
          mobileView === 'project' ? 'flex' : 'hidden',
        )}
      >
        <ProjectPane
          project={project}
          agentBusy={chatBusy || Boolean(activeRun)}
          reloadSignal={previewKey}
          retrying={busy === 'retry'}
          onRetry={() => void retry()}
          onSaved={composer.addNote}
          composer={composer}
          onAsk={ask}
          onVisualEdit={composer.addNote}
          onShowChat={() => {
            setMobileView('chat')
            setChatCollapsed(false)
          }}
          chatToggle={
            <>
              <button
                type="button"
                onClick={() => setMobileView('chat')}
                aria-label="Show chat"
                title="Show chat"
                className={small + ' relative md:hidden'}
              >
                <MessageSquare className="h-4 w-4" />
                {activeRun && (
                  <span
                    aria-hidden
                    className="absolute top-1.5 right-1.5 h-2 w-2 animate-pulse rounded-full bg-signal"
                  />
                )}
              </button>
              {chatCollapsed && (
                <button
                  type="button"
                  onClick={() => setChatCollapsed(false)}
                  aria-label="Show chat"
                  title="Show chat"
                  aria-expanded={false}
                  className={small + ' relative hidden md:grid'}
                >
                  <PanelLeftOpen className="h-4 w-4" />
                  {activeRun && (
                    <span
                      aria-hidden
                      className="absolute top-1.5 right-1.5 h-2 w-2 animate-pulse rounded-full bg-signal"
                    />
                  )}
                </button>
              )}
            </>
          }
        />
      </div>
      {error && (
        <p
          role="alert"
          onClick={() => setError('')}
          className="fixed top-[max(0.75rem,env(safe-area-inset-top))] left-1/2 z-50 max-w-[calc(100%-2rem)] -translate-x-1/2 rise cursor-pointer rounded-full border border-danger/30 bg-raised px-4 py-2 text-sm text-danger shadow-xl"
        >
          {error}
        </p>
      )}
    </div>
  )
}
