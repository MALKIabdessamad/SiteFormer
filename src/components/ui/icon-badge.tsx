import type { ReactNode } from 'react'

/** Sculpted square holding a status icon, used at the top of auth screens. */
export function IconBadge({ children }: { children: ReactNode }) {
  return (
    <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl text-signal box-sculpted">
      {children}
    </span>
  )
}
