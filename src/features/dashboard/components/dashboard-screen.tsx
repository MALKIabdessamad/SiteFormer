import { useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Alert } from '~/components/ui/alert'
import { authService, useRedirectOnSignOut } from '~/features/auth'
import { useSidebar } from '../hooks/use-sidebar'
import type { SiteSummary } from '../types'
import { AppSidebar } from './app-sidebar'
import { MobileTopBar } from './mobile-top-bar'
import { PromptBox, type PromptBoxHandle } from './prompt-box'

type DashboardScreenProps = {
  email: string
  /** Sites listed in the sidebar. Empty until site generation is connected. */
  sites?: SiteSummary[]
}

/** Dashboard UI: sidebar + "what are we building" prompt. Site generation is not wired yet. */
export function DashboardScreen({ email, sites = [] }: DashboardScreenProps) {
  const navigate = useNavigate()
  const sidebar = useSidebar()
  const promptRef = useRef<PromptBoxHandle>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [signingOut, setSigningOut] = useState(false)

  useRedirectOnSignOut()

  const startNewSite = () => {
    sidebar.closeDrawer()
    setNotice('')
    setError('')
    promptRef.current?.clear()
    promptRef.current?.focus()
  }

  const handlePrompt = () => {
    setError('')
    setNotice('Building sites isn’t connected yet. Your prompt is saved as a draft.')
  }

  const signOut = async () => {
    setSigningOut(true)
    const result = await authService.signOut()
    if (!result.ok) {
      setSigningOut(false)
      setError(result.error)
      return
    }
    void navigate({ to: '/', replace: true })
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-sidebar text-ink">
      {sidebar.open && (
        <div
          aria-hidden
          className="fixed inset-0 z-30 bg-paper/70 backdrop-blur-[1px]"
          onClick={sidebar.closeDrawer}
        />
      )}
      <AppSidebar
        email={email}
        sites={sites}
        collapsed={sidebar.collapsed}
        open={sidebar.open}
        closeButtonRef={sidebar.closeButtonRef}
        onToggleCollapsed={sidebar.toggleCollapsed}
        onClose={sidebar.closeDrawer}
        onNewSite={startNewSite}
        onSignOut={() => void signOut()}
        signingOut={signingOut}
      />
      <main className="relative flex min-w-0 flex-1 flex-col lg:p-2 lg:pl-0">
        <MobileTopBar
          menuOpen={sidebar.open}
          onOpenMenu={sidebar.openDrawer}
          menuButtonRef={sidebar.menuButtonRef}
        />
        <section className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto bg-paper px-4 pt-20 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-8 lg:rounded-[28px] lg:border lg:py-8">
          <p className="rise font-mono text-xs tracking-[0.14em] text-faint uppercase">
            Hi {email.split('@')[0]}
          </p>
          <h1
            className="mt-3 rise text-center font-display text-[32px] leading-[1.05] font-extrabold tracking-[-0.035em] text-balance sm:text-5xl"
            style={{ animationDelay: '60ms' }}
          >
            What site are we{' '}
            <span className="pr-[0.06em] font-normal text-dim italic">building</span> today?
          </h1>
          <div className="mt-7 flex w-full rise justify-center" style={{ animationDelay: '120ms' }}>
            <PromptBox ref={promptRef} onSubmit={handlePrompt} />
          </div>
          {(notice || error) && (
            <div className="mt-4 w-full max-w-[670px] text-center">
              <Alert tone={error ? 'error' : 'info'}>{error || notice}</Alert>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
