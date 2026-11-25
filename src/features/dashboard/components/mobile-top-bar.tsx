import type { RefObject } from 'react'
import { Menu } from 'lucide-react'
import { site } from '~/config/site'

type MobileTopBarProps = {
  menuOpen: boolean
  onOpenMenu: () => void
  menuButtonRef: RefObject<HTMLButtonElement | null>
}

/** Floating bar with the menu button, shown below the desktop breakpoint. */
export function MobileTopBar({ menuOpen, onOpenMenu, menuButtonRef }: MobileTopBarProps) {
  return (
    <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 lg:hidden">
      <button
        ref={menuButtonRef}
        type="button"
        onClick={onOpenMenu}
        aria-label="Open menu"
        aria-expanded={menuOpen}
        aria-controls="app-sidebar"
        className="grid h-11 w-11 place-items-center rounded-xl border bg-ink/[0.08] backdrop-blur-md transition-colors hover:bg-ink/[0.14] active:scale-95"
      >
        <Menu className="h-5 w-5" />
      </button>
      <span className="font-display text-base font-bold tracking-tight">{site.name}</span>
      <span className="w-11" aria-hidden />
    </div>
  )
}
