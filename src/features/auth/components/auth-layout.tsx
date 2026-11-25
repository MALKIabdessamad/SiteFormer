import type { ReactNode } from 'react'
import { Logo } from '~/components/brand/logo'
import { BrandPanel } from './brand-panel'

/** Two-column shell: brand panel on the left, the auth card centered on the right. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-paper lg:grid-cols-2">
      <BrandPanel />
      <main className="flex flex-col px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-10">
        <div className="w-fit lg:hidden">
          <Logo />
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[400px]">{children}</div>
        </div>
      </main>
    </div>
  )
}
