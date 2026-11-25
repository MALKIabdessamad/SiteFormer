import { useMemo, useState, type ReactNode, type RefObject } from 'react'
import { Link } from '@tanstack/react-router'
import { Coins, Globe, LayoutTemplate, LogOut, PanelLeft, Plus, Search, X } from 'lucide-react'
import { Logo } from '~/components/brand/logo'
import { cn } from '~/lib/utils/cn'
import type { SiteSummary } from '../types'

const itemClass =
  'flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] text-dim transition-colors hover:bg-ink/[0.06] hover:text-ink lg:h-10'
const iconButtonClass =
  'grid h-11 w-11 shrink-0 place-items-center rounded-lg text-dim transition-colors hover:bg-ink/[0.06] hover:text-ink lg:h-9 lg:w-9'

/** Show the filter box once the list gets long. */
const FILTER_THRESHOLD = 6

type AppSidebarProps = {
  email: string
  sites: SiteSummary[]
  collapsed: boolean
  open: boolean
  closeButtonRef: RefObject<HTMLButtonElement | null>
  onToggleCollapsed: () => void
  onClose: () => void
  onNewSite: () => void
  onSignOut: () => void
  signingOut?: boolean
}

export function AppSidebar({
  email,
  sites,
  collapsed,
  open,
  closeButtonRef,
  onToggleCollapsed,
  onClose,
  onNewSite,
  onSignOut,
  signingOut = false,
}: AppSidebarProps) {
  const [query, setQuery] = useState('')
  const name = email.split('@')[0] || 'You'
  const q = query.trim().toLowerCase()
  const visible = useMemo(
    () => (q ? sites.filter((s) => s.name.toLowerCase().includes(q)) : sites),
    [sites, q],
  )
  // Labels hide when the desktop sidebar is collapsed to icons.
  const label = collapsed ? 'lg:hidden' : undefined
  const iconOnly = collapsed && 'lg:justify-center lg:px-0'

  return (
    <aside
      id="app-sidebar"
      aria-label="Sidebar"
      className={cn(
        'fixed inset-y-0 left-0 z-40 flex w-[min(85vw,300px)] flex-col bg-sidebar px-2 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-[transform,width] duration-200 lg:static lg:translate-x-0',
        collapsed ? 'lg:w-[68px]' : 'lg:w-[260px]',
        open ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
      )}
    >
      <div
        className={cn(
          'flex items-center justify-between py-1',
          collapsed && 'lg:flex-col lg:gap-2',
        )}
      >
        <Link to="/dashboard" className="flex min-w-0 items-center rounded-lg px-2 py-1">
          <span className={label}>
            <Logo />
          </span>
          {collapsed && (
            <span className="hidden lg:block">
              <Logo withName={false} />
            </span>
          )}
        </Link>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          className={cn(iconButtonClass, 'lg:hidden')}
        >
          <X className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={(collapsed ? 'Expand' : 'Collapse') + ' sidebar (Ctrl/⌘ B)'}
          className={cn(iconButtonClass, 'hidden lg:grid')}
        >
          <PanelLeft className="h-5 w-5" />
        </button>
      </div>

      <nav aria-label="Main" className="mt-3 space-y-0.5">
        <button
          type="button"
          title="New site"
          onClick={onNewSite}
          className={cn(itemClass, 'bg-ink/[0.07] text-ink', iconOnly)}
        >
          <Plus className="h-5 w-5 shrink-0" />
          <span className={label}>New site</span>
        </button>
        <SoonItem
          icon={<Coins className="h-5 w-5 shrink-0" />}
          label="Credits"
          collapsed={collapsed}
        />
        <SoonItem
          icon={<Globe className="h-5 w-5 shrink-0" />}
          label="Domains"
          collapsed={collapsed}
        />
      </nav>

      <div className={cn('mt-6 flex min-h-0 flex-1 flex-col', collapsed && 'lg:hidden')}>
        <h2 className="mb-1 px-3 text-xs font-medium text-faint">Your sites</h2>
        {sites.length > FILTER_THRESHOLD && (
          <label className="mx-1 mb-2 flex h-9 items-center gap-2 rounded-lg border bg-ink/[0.03] px-2.5 text-dim">
            <Search className="h-4 w-4 shrink-0" aria-hidden />
            <span className="sr-only">Filter sites</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter"
              className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint"
            />
          </label>
        )}
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain">
          {visible.map((site) => (
            <li key={site.id}>
              <button type="button" onClick={onClose} className={cn(itemClass, 'min-w-0')}>
                <LayoutTemplate className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">{site.name}</span>
              </button>
            </li>
          ))}
          {visible.length === 0 && (
            <li className="px-3 py-2 text-sm text-dim">
              {q ? 'No sites match.' : 'No sites yet. Describe one to start.'}
            </li>
          )}
        </ul>
      </div>
      {collapsed && <div className="hidden flex-1 lg:block" />}

      <div
        className={cn(
          'mt-3 flex items-center gap-3 rounded-xl px-2 py-2',
          collapsed && 'lg:flex-col lg:gap-2 lg:px-0',
        )}
      >
        <span
          title={email}
          aria-hidden
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink text-sm font-bold text-paper uppercase"
        >
          {name[0]}
        </span>
        <span className={cn('min-w-0 flex-1', label)}>
          <span className="block truncate text-sm font-medium">{name}</span>
          <span className="block truncate text-xs text-faint">{email}</span>
        </span>
        <button
          type="button"
          onClick={onSignOut}
          disabled={signingOut}
          aria-label="Sign out"
          title="Sign out"
          className={cn(iconButtonClass, 'disabled:opacity-50')}
        >
          <LogOut className="h-5 w-5" />
        </button>
      </div>
    </aside>
  )
}

/** A nav entry for a section that isn't built yet. */
function SoonItem({
  icon,
  label,
  collapsed,
}: {
  icon: ReactNode
  label: string
  collapsed: boolean
}) {
  return (
    <button
      type="button"
      title={`${label} (coming soon)`}
      aria-disabled="true"
      className={cn(
        itemClass,
        'cursor-not-allowed opacity-70 hover:bg-transparent hover:text-dim',
        collapsed && 'lg:justify-center lg:px-0',
      )}
    >
      {icon}
      <span className={collapsed ? 'lg:hidden' : undefined}>{label}</span>
      {!collapsed && (
        <span className="ml-auto rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wide text-faint uppercase">
          Soon
        </span>
      )}
    </button>
  )
}
