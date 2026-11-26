import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, CornerDownLeft, Loader2, RotateCw, Search } from 'lucide-react'
import { useDismiss } from '~/hooks/use-dismiss'
import { cn } from '~/lib/utils/cn'
import { listSitePages } from '../api/code.functions'
import { isDynamicPage, pagePrefix, toPath } from '../lib/site-pages'

type Row = { kind: 'page' | 'open'; path: string }

/** A path with its parameters ("$id") dimmed: they are filled in before opening. */
function PathLabel({ path }: { path: string }) {
  if (!isDynamicPage(path)) return path
  return path.split(/(\/)/).map((part, i) =>
    part.includes('$') ? (
      <span key={i} className="text-faint">
        {part}
      </span>
    ) : (
      part
    ),
  )
}

/**
 * The preview's path bar: reload, and the current page, which opens the site's pages with a box
 * to find one or type any path. Long paths keep their end visible ("…/posts/42").
 */
export function PagePicker({
  projectId,
  path,
  disabled,
  onGo,
  onReload,
}: {
  projectId: string
  path: string
  disabled: boolean
  onGo: (path: string) => void
  onReload: () => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(-1)
  const [pages, setPages] = useState<string[] | null>(null)
  const [failed, setFailed] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  useDismiss(open, setOpen, root, trigger)

  // Ready to type with a mouse and keyboard; on touch screens the keyboard waits for a tap.
  useEffect(() => {
    if (open && window.matchMedia('(pointer: fine)').matches) input.current?.focus()
  }, [open])

  const toggle = () => {
    if (open) return setOpen(false)
    setQuery('')
    setActive(-1)
    setOpen(true)
    // Fresh on every open: the agent may have added pages since.
    listSitePages({ data: { projectId } }).then(
      (result) => {
        setPages(result.pages)
        setFailed(false)
      },
      () => setFailed(true),
    )
  }

  const needle = query.trim().toLowerCase()
  const typed = needle ? toPath(query) : null
  const listed = pages?.includes(path) ? pages : [path, ...(pages ?? [])]
  const rows: Row[] = [
    ...(typed && !listed.includes(typed) ? [{ kind: 'open' as const, path: typed }] : []),
    ...listed
      .filter((page) => page.toLowerCase().includes(needle))
      .map((page) => ({ kind: 'page' as const, path: page })),
  ]
  const optionId = (index: number) => `${id}-option-${index}`

  const choose = (row: Row) => {
    if (row.kind === 'page' && isDynamicPage(row.path)) {
      // "/posts/$id": start the path and let the user type the rest.
      setQuery(pagePrefix(row.path))
      setActive(0)
      input.current?.focus()
      return
    }
    setOpen(false)
    trigger.current?.focus()
    onGo(row.path)
  }

  const move = (step: 1 | -1) => {
    if (rows.length === 0) return
    const next =
      active < 0 ? (step === 1 ? 0 : rows.length - 1) : (active + step + rows.length) % rows.length
    setActive(next)
    document.getElementById(optionId(next))?.scrollIntoView({ block: 'nearest' })
  }

  return (
    <div
      ref={root}
      className={cn(
        'relative flex h-9 min-w-0 flex-1 items-center rounded-full border bg-raised pl-1 transition-colors lg:w-80 lg:flex-initial md:pointer-fine:h-8',
        open && 'border-signal/60',
      )}
    >
      <button
        type="button"
        onClick={onReload}
        disabled={disabled}
        aria-label="Reload preview"
        title="Reload preview"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-dim transition-colors hover:bg-ink/[0.06] hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <RotateCw className="h-3.5 w-3.5" />
      </button>
      <button
        ref={trigger}
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Page ${path}. Change page`}
        title={path}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-r-full pr-3 pl-1 font-mono text-xs text-dim transition-colors outline-none hover:text-ink focus-visible:text-ink disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="min-w-0 flex-1 truncate-start">
          <bdi>{path}</bdi>
        </span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-faint transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Pages"
          className="absolute top-full left-0 z-30 mt-2 w-full min-w-64 rise overflow-hidden rounded-2xl border bg-raised shadow-xl"
        >
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
            <input
              ref={input}
              role="combobox"
              aria-expanded
              aria-controls={`${id}-list`}
              aria-autocomplete="list"
              aria-activedescendant={rows[active] ? optionId(active) : undefined}
              aria-label="Find a page or enter a path"
              placeholder="Find page or enter path"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(e.target.value.trim() ? 0 : -1)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  move(e.key === 'ArrowDown' ? 1 : -1)
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  const row =
                    rows[active] ?? (typed ? { kind: 'open' as const, path: typed } : null)
                  if (row) choose(row)
                }
              }}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              enterKeyHint="go"
              className="h-10 min-w-0 flex-1 bg-transparent font-mono text-xs text-ink outline-none placeholder:font-sans placeholder:text-faint"
            />
          </div>
          <ul
            id={`${id}-list`}
            role="listbox"
            aria-label="Pages"
            className="max-h-72 overflow-y-auto p-1.5"
          >
            {rows.map((row, i) => (
              <li
                key={`${row.kind}:${row.path}`}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                aria-current={row.kind === 'page' && row.path === path ? 'page' : undefined}
                onMouseMove={() => i !== active && setActive(i)}
                onClick={() => choose(row)}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-2 font-mono text-xs transition-colors',
                  i === active ? 'bg-ink/[0.06] text-ink' : 'text-dim',
                )}
              >
                {row.kind === 'open' ? (
                  <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
                ) : (
                  <Check
                    className={cn(
                      'h-3.5 w-3.5 shrink-0 text-signal',
                      row.path !== path && 'invisible',
                    )}
                    aria-hidden
                  />
                )}
                <span className="min-w-0 flex-1 truncate-start">
                  <bdi>
                    {row.kind === 'open' && <span className="font-sans text-faint">Open </span>}
                    <PathLabel path={row.path} />
                  </bdi>
                </span>
              </li>
            ))}
            {pages === null && (
              <li
                role="presentation"
                className="flex items-center gap-2 px-2.5 py-2 text-xs text-faint"
              >
                {failed ? (
                  'Couldn’t load the pages. You can still type a path.'
                ) : (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    Loading pages…
                  </>
                )}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
