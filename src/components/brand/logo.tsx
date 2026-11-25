import { site } from '~/config/site'

export function LogoMark() {
  return (
    <span className="grid h-7 w-7 shrink-0 btn-sculpted place-items-center rounded-lg">
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
        <path d="M3 3h10v3H3zM3 7.5h4.5V13H3zM9 7.5h4V13H9z" fill="currentColor" />
      </svg>
    </span>
  )
}

export function Logo({ withName = true }: { withName?: boolean }) {
  return (
    <span className="flex items-center gap-2.5 font-display text-lg font-bold tracking-tight">
      <LogoMark />
      {withName ? site.name : <span className="sr-only">{site.name}</span>}
    </span>
  )
}
