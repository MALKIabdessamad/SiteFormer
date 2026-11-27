import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronRight,
  File,
  Folder,
  Loader2,
  Lock,
  RefreshCw,
  RotateCcw,
  Save,
} from 'lucide-react'
import { cn } from '~/lib/utils/cn'
import { toErrorMessage } from '~/lib/utils/errors'
import { listProjectFiles, readProjectFile, saveProjectFile } from '../api/code.functions'
import { buildTree, defaultFile, foldersOf, type TreeNode } from '../lib/file-tree'

const CodeEditor = lazy(() => import('./code-editor'))

type Loaded =
  | { kind: 'text'; content: string; hash: string; size: number }
  | { kind: 'binary'; size: number }
  | { kind: 'large'; size: number }

const iconButton =
  'grid h-9 w-9 shrink-0 place-items-center rounded-lg text-dim transition-colors hover:bg-ink/[0.06] hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 md:pointer-fine:h-8 md:pointer-fine:w-8'

/**
 * The project's code: a file tree and an editor. Saving commits the change as a checkpoint and
 * notes it in the chat. Editing is locked while the agent works; files the agent changed reload
 * when its run ends (unless you have unsaved edits there).
 */
export function CodePanel({
  projectId,
  ready,
  agentBusy,
  refreshSignal,
  onSaved,
}: {
  projectId: string
  ready: boolean
  agentBusy: boolean
  /** Changes when files may have changed (a run finished, a restore). */
  refreshSignal: number
  /** Saved: `note` is what the chat now ends with. */
  onSaved: (note: string) => void
}) {
  const [files, setFiles] = useState<Array<string> | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [listError, setListError] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  // Keyed by path, so switching files never shows the previous file's content or edits.
  const [file, setFile] = useState<{ path: string; data?: Loaded; error?: string } | null>(null)
  const [draftOf, setDraftOf] = useState<{ path: string; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [showEditor, setShowEditor] = useState(false) // phones: tree or editor
  const current = file && file.path === selected ? file : null
  const loaded = current?.data ?? null
  const fileError = current?.error ?? ''
  const draft = draftOf && draftOf.path === selected ? draftOf.text : null
  const setDraft = useCallback(
    (text: string | null) =>
      setDraftOf(text === null || !selected ? null : { path: selected, text }),
    [selected],
  )
  const dirty = loaded?.kind === 'text' && draft !== null && draft !== loaded.content

  const selectedRef = useRef(selected)
  useEffect(() => {
    selectedRef.current = selected
  }, [selected])

  const applyList = useCallback((result: { files: Array<string>; truncated: boolean }) => {
    setListError('')
    setFiles(result.files)
    setTruncated(result.truncated)
    // Keep the open file if it still exists; otherwise open the home page and reveal it.
    const current = selectedRef.current
    if (current && result.files.includes(current)) return
    const first = defaultFile(result.files)
    setSelected(first)
    setOpen((set) => new Set([...set, ...foldersOf(first)]))
  }, [])
  const listFailed = useCallback((err: unknown) => setListError(toErrorMessage(err)), [])
  const loadList = useCallback(
    () =>
      ready
        ? listProjectFiles({ data: { projectId } }).then(applyList, listFailed)
        : Promise.resolve(),
    [projectId, ready, applyList, listFailed],
  )

  const loadFile = useCallback(
    (path: string) =>
      readProjectFile({ data: { projectId, path } }).then(
        (result) => setFile({ path, data: result as Loaded }),
        (err: unknown) => setFile({ path, error: toErrorMessage(err) }),
      ),
    [projectId],
  )

  useEffect(() => {
    void loadList()
  }, [loadList])

  useEffect(() => {
    if (selected) void loadFile(selected)
  }, [selected, loadFile])

  // The agent (or a restore) may have changed files: refresh, but never drop unsaved edits.
  const latest = useRef({ selected, dirty, loadList, loadFile })
  useEffect(() => {
    latest.current = { selected, dirty, loadList, loadFile }
  })
  useEffect(() => {
    if (refreshSignal === 0) return
    const now = latest.current
    void now.loadList()
    if (now.selected && !now.dirty) void now.loadFile(now.selected)
  }, [refreshSignal])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(timer)
  }, [notice])

  // Warn before leaving the page with unsaved edits.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const select = (path: string) => {
    if (path === selected) return setShowEditor(true)
    if (dirty && !window.confirm('Discard your unsaved changes to this file?')) return
    setSelected(path)
    setShowEditor(true)
  }

  const save = async () => {
    if (!selected || loaded?.kind !== 'text' || !dirty || saving || agentBusy) return
    setSaving(true)
    try {
      const result = await saveProjectFile({
        data: { projectId, path: selected, content: draft!, baseHash: loaded.hash },
      })
      setFile({ path: selected, data: { ...loaded, content: draft!, hash: result.hash } })
      setDraftOf(null)
      setNotice({ kind: 'ok', text: 'Saved. The change is in the chat and the preview.' })
      if (result.note) onSaved(result.note)
    } catch (err) {
      setNotice({ kind: 'error', text: toErrorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  const tree = useMemo(() => buildTree(files ?? []), [files])
  const toggle = (path: string) =>
    setOpen((set) => {
      const next = new Set(set)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  if (!ready) return <Message>The code appears when your sandbox is ready.</Message>
  if (listError && files === null) {
    return (
      <Message>
        <span className="text-danger">{listError}</span>
        <button
          type="button"
          onClick={() => void loadList()}
          className="mt-4 h-9 rounded-full px-5 text-sm font-semibold box-sculpted"
        >
          Try again
        </button>
      </Message>
    )
  }
  if (files === null)
    return (
      <Message>
        <Loader2 className="h-6 w-6 animate-spin text-dim" aria-label="Loading files" />
      </Message>
    )

  const readOnly = agentBusy || saving || loaded?.kind !== 'text'

  return (
    <section
      aria-label="Project code"
      className="grid h-full min-h-0 md:grid-cols-[240px_minmax(0,1fr)]"
    >
      <div className={cn(showEditor ? 'hidden md:flex' : 'flex', 'min-h-0 flex-col border-r')}>
        <div className="flex h-11 shrink-0 items-center justify-between border-b px-3">
          <span className="text-xs font-medium text-faint">{files.length} files</span>
          <button
            type="button"
            onClick={() => void loadList()}
            aria-label="Refresh files"
            title="Refresh files"
            className={iconButton}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        <ul
          role="tree"
          aria-label="Files"
          className="relative min-h-0 flex-1 overflow-y-auto py-1.5 text-[13px]"
        >
          {tree.map((node) => (
            <TreeRow
              key={node.path}
              node={node}
              depth={0}
              open={open}
              selected={selected}
              dirtyPath={dirty ? selected : null}
              onToggle={toggle}
              onSelect={select}
            />
          ))}
          {truncated && (
            <li className="px-3 py-2 text-xs text-faint">Showing the first 2000 files.</li>
          )}
        </ul>
      </div>

      <div className={cn(showEditor ? 'flex' : 'hidden md:flex', 'min-h-0 min-w-0 flex-col')}>
        {selected ? (
          <>
            <div className="flex h-11 shrink-0 items-center gap-1.5 border-b px-2">
              <button
                type="button"
                onClick={() => setShowEditor(false)}
                aria-label="Back to files"
                className={iconButton + ' md:hidden'}
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span
                className="min-w-0 flex-1 truncate px-1 font-mono text-xs text-dim"
                title={selected}
              >
                {selected}
                {dirty && (
                  <span className="ml-1.5 text-signal" aria-label="Unsaved changes">
                    ●
                  </span>
                )}
              </span>
              {agentBusy ? (
                <span className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium text-faint">
                  <Lock className="h-3 w-3" aria-hidden /> Agent working
                </span>
              ) : loaded && loaded.kind !== 'text' ? (
                <span className="rounded-full border px-2 py-0.5 text-[10px] font-medium text-faint">
                  Read only
                </span>
              ) : null}
              {dirty && (
                <button
                  type="button"
                  onClick={() => setDraft(null)}
                  disabled={saving}
                  aria-label="Discard changes"
                  title="Discard changes"
                  className={iconButton}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => void save()}
                disabled={!dirty || saving || agentBusy}
                title={agentBusy ? 'Wait for the agent to finish' : 'Save (Ctrl/⌘ S)'}
                className="inline-flex h-8 shrink-0 btn-sculpted items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Save className="h-3.5 w-3.5" aria-hidden />
                )}
                Save
              </button>
            </div>
            <div className="relative min-h-0 flex-1 bg-[#282c34]">
              {fileError ? (
                <Message>
                  <span className="text-danger">{fileError}</span>
                </Message>
              ) : !loaded ? (
                <Message>
                  <Loader2 className="h-5 w-5 animate-spin text-dim" aria-label="Loading file" />
                </Message>
              ) : loaded.kind === 'binary' ? (
                <Message>
                  This is a binary file (an image or similar), so it can’t be shown here.
                </Message>
              ) : loaded.kind === 'large' ? (
                <Message>This file is over 1 MB, so it can’t be opened in the editor.</Message>
              ) : (
                <Suspense
                  fallback={
                    <Message>
                      <Loader2
                        className="h-5 w-5 animate-spin text-dim"
                        aria-label="Loading editor"
                      />
                    </Message>
                  }
                >
                  <CodeEditor
                    path={selected}
                    value={draft ?? loaded.content}
                    readOnly={readOnly}
                    onChange={setDraft}
                    onSave={() => void save()}
                  />
                </Suspense>
              )}
              {notice && (
                <p
                  role={notice.kind === 'error' ? 'alert' : 'status'}
                  className={cn(
                    'absolute right-3 bottom-3 left-3 mx-auto flex max-w-md rise items-start gap-2 rounded-xl border bg-raised px-3 py-2 text-xs shadow-xl',
                    notice.kind === 'error' ? 'border-danger/30 text-danger' : 'text-ink',
                  )}
                >
                  {notice.kind === 'ok' && (
                    <Check className="mt-px h-3.5 w-3.5 shrink-0 text-signal" aria-hidden />
                  )}
                  <span className="flex-1">{notice.text}</span>
                  {notice.kind === 'error' && selected && (
                    <button
                      type="button"
                      onClick={() => {
                        setDraftOf(null)
                        setNotice(null)
                        void loadFile(selected)
                      }}
                      className="shrink-0 font-semibold text-ink underline-offset-2 hover:underline"
                    >
                      Reload file
                    </button>
                  )}
                </p>
              )}
            </div>
          </>
        ) : (
          <Message>No files yet.</Message>
        )}
      </div>
    </section>
  )
}

function Message({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-full place-items-center p-6 text-center text-sm text-dim">
      <div className="flex flex-col items-center">{children}</div>
    </div>
  )
}

function TreeRow({
  node,
  depth,
  open,
  selected,
  dirtyPath,
  onToggle,
  onSelect,
}: {
  node: TreeNode
  depth: number
  open: Set<string>
  selected: string | null
  dirtyPath: string | null
  onToggle: (path: string) => void
  onSelect: (path: string) => void
}) {
  const pad = { paddingLeft: 10 + depth * 14 }
  if (node.kind === 'file') {
    return (
      <li role="treeitem" aria-selected={selected === node.path}>
        <button
          type="button"
          onClick={() => onSelect(node.path)}
          style={pad}
          className={cn(
            'flex h-9 w-full items-center gap-2 pr-3 text-left transition-colors hover:bg-ink/[0.06] md:pointer-fine:h-7',
            selected === node.path ? 'bg-ink/[0.09] text-ink' : 'text-dim',
          )}
        >
          <File className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
          <span className="truncate">{node.name}</span>
          {dirtyPath === node.path && (
            <span className="ml-auto text-signal" aria-hidden>
              ●
            </span>
          )}
        </button>
      </li>
    )
  }
  const isOpen = open.has(node.path)
  return (
    <li role="treeitem" aria-expanded={isOpen}>
      <button
        type="button"
        onClick={() => onToggle(node.path)}
        style={pad}
        className="flex h-9 w-full items-center gap-1.5 pr-3 text-left text-dim transition-colors hover:bg-ink/[0.06] md:pointer-fine:h-7"
      >
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-faint transition-transform',
            isOpen && 'rotate-90',
          )}
          aria-hidden
        />
        <Folder className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
        <span className="truncate">{node.name}</span>
      </button>
      {isOpen && (
        <ul role="group">
          {node.children.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              open={open}
              selected={selected}
              dirtyPath={dirtyPath}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
