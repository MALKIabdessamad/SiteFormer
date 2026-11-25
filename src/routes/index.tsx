import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, LogOut, MailCheck } from 'lucide-react'
import type { User } from '@supabase/supabase-js'
import { Logo } from '../components/logo'
import { supabase } from '../lib/supabase'

type Search = { mode?: 'signup' }

// The home page is the auth page. Sessions live in the browser, so it renders on the client.
export const Route = createFileRoute('/')({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): Search => ({
    mode: s.mode === 'signup' ? 'signup' : undefined,
  }),
  loader: async () => {
    const { data } = await supabase.auth.getSession()
    return { user: data.session?.user ?? null }
  },
  component: AuthPage,
})

const field =
  'h-12 w-full rounded-full border bg-ink/[0.04] px-5 text-base text-ink placeholder:text-faint outline-none transition focus:border-signal/70 focus:bg-ink/[0.06] focus-visible:ring-4 focus-visible:ring-signal/20'

type View = 'form' | 'sent' | 'recovery'

function AuthPage() {
  const search = Route.useSearch()
  const initial = Route.useLoaderData()
  const [user, setUser] = useState<User | null>(initial.user)
  const [view, setView] = useState<View>('form')
  const [isIn, setIsIn] = useState(search.mode !== 'signup')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // A password-reset link signs the user in with a recovery session: ask for a new password.
      if (event === 'PASSWORD_RECOVERY') {
        setView('recovery')
        setPassword('')
        setError('')
        setNotice('')
      }
      setUser(session?.user ?? null)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const reset = () => {
    setError('')
    setNotice('')
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    reset()
    const { data, error } = isIn
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + '/' },
        })
    setBusy(false)
    if (error) return setError(error.message)
    // With email confirmation on, sign-up returns no session until the link is clicked.
    if (!data.session) return setView('sent')
    setPassword('')
  }

  const forgot = async () => {
    reset()
    if (!email) return setError('Enter your email above first.')
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/',
    })
    if (error) setError(error.message)
    else setNotice('Password reset link sent. Check your email.')
  }

  const updatePassword = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    reset()
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return setError(error.message)
    setPassword('')
    setView('form')
  }

  const signOut = async () => {
    setBusy(true)
    await supabase.auth.signOut()
    setBusy(false)
    setView('form')
    setIsIn(true)
    reset()
  }

  const switchMode = () => {
    setIsIn((v) => !v)
    setView('form')
    reset()
  }

  let content: ReactNode
  if (view === 'recovery') {
    content = (
      <div className="rise">
        <span className="box-sculpted mx-auto grid h-14 w-14 place-items-center rounded-2xl text-signal">
          <KeyRound className="h-6 w-6" />
        </span>
        <h1 className="mt-6 text-center font-display text-3xl font-extrabold tracking-[-0.03em]">
          Set a new password
        </h1>
        <p className="mt-2 text-center text-sm text-dim">
          Choose a new password for{' '}
          <span className="font-semibold break-all text-ink">{user?.email}</span>.
        </p>
        <form onSubmit={updatePassword} className="mt-8 space-y-4">
          <PasswordField
            value={password}
            onChange={setPassword}
            show={show}
            onToggle={() => setShow((v) => !v)}
            autoComplete="new-password"
            placeholder="At least 6 characters"
            label="New password"
          />
          <Messages error={error} notice={notice} />
          <Submit busy={busy} label="Update password" busyLabel="Updating…" />
        </form>
      </div>
    )
  } else if (user) {
    content = (
      <div className="rise text-center" role="status">
        <span className="box-sculpted mx-auto grid h-14 w-14 place-items-center rounded-2xl text-signal">
          <CheckCircle2 className="h-6 w-6" />
        </span>
        <h1 className="mt-6 font-display text-3xl font-extrabold tracking-[-0.03em]">
          You&apos;re signed in
        </h1>
        <p className="mt-3 text-sm text-dim">
          Signed in as <span className="font-semibold break-all text-ink">{user.email}</span>.
        </p>
        <button
          type="button"
          onClick={signOut}
          disabled={busy}
          className="box-sculpted mt-8 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full text-sm font-semibold hover:border-white/35 disabled:opacity-70"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
          Sign out
        </button>
      </div>
    )
  } else if (view === 'sent') {
    content = (
      <div className="rise text-center" role="status">
        <span className="box-sculpted mx-auto grid h-14 w-14 place-items-center rounded-2xl text-signal">
          <MailCheck className="h-6 w-6" />
        </span>
        <h1 className="mt-6 font-display text-3xl font-extrabold tracking-[-0.03em]">
          Check your inbox
        </h1>
        <p className="mt-3 text-sm text-dim">
          We sent a confirmation link to{' '}
          <span className="font-semibold break-all text-ink">{email}</span>. Open it to finish
          creating your account.
        </p>
        <button
          type="button"
          onClick={() => {
            setView('form')
            setIsIn(true)
          }}
          className="box-sculpted mt-8 h-12 w-full rounded-full text-sm font-semibold hover:border-white/35"
        >
          Back to sign in
        </button>
      </div>
    )
  } else {
    content = (
      <div key={String(isIn)} className="rise">
        <h1 className="text-center font-display text-4xl leading-tight font-extrabold tracking-[-0.035em]">
          {isIn ? 'Welcome back' : 'Create your account'}
        </h1>
        <p className="mt-2 text-center text-sm text-dim">
          {isIn ? 'Sign in to keep building.' : 'Your first site is free.'}
        </p>

        <form onSubmit={submit} className="mt-8 space-y-4">
          <div>
            <label htmlFor="email" className="mb-1.5 block pl-1 text-xs font-semibold">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={field}
            />
          </div>
          <PasswordField
            value={password}
            onChange={setPassword}
            show={show}
            onToggle={() => setShow((v) => !v)}
            autoComplete={isIn ? 'current-password' : 'new-password'}
            placeholder={isIn ? 'Your password' : 'At least 6 characters'}
            label="Password"
            extra={
              isIn && (
                <button
                  type="button"
                  onClick={forgot}
                  className="text-xs text-dim transition hover:text-ink"
                >
                  Forgot password?
                </button>
              )
            }
          />
          <Messages error={error} notice={notice} />
          <Submit
            busy={busy}
            label={isIn ? 'Sign in' : 'Create account'}
            busyLabel={isIn ? 'Signing in…' : 'Creating account…'}
          />
        </form>

        <p className="mt-7 text-center text-sm text-dim">
          {isIn ? 'New to Siteform? ' : 'Already have an account? '}
          <button
            type="button"
            onClick={switchMode}
            className="font-semibold text-ink hover:underline"
          >
            {isIn ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      </div>
    )
  }

  return (
    <div className="grid min-h-dvh bg-paper lg:grid-cols-2">
      <aside className="hidden flex-col justify-between border-r bg-sidebar p-12 lg:flex xl:p-16">
        <Logo />
        <div>
          <h2 className="font-display text-5xl leading-[1] font-extrabold tracking-[-0.035em] xl:text-6xl">
            Describe it.
            <br />
            <span className="pr-[0.06em] font-normal text-dim italic">Publish</span> it.
          </h2>
          <p className="mt-5 max-w-md text-dim">
            Tell Siteform what your business does. It lays out the pages, and you put them live
            on your own domain.
          </p>
          <div className="mt-10 max-w-md space-y-3" aria-hidden>
            <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-raised px-4 py-3 text-sm">
              A site for my bakery with a menu and opening hours
            </div>
            <div className="w-fit max-w-[90%] rounded-2xl rounded-bl-md border bg-ink/[0.03] px-4 py-3 text-sm text-dim">
              <span className="text-signal">✓</span> 4 pages ready · bluebird-bakery.com
            </div>
          </div>
        </div>
        <p className="text-sm text-faint">© {new Date().getFullYear()} Siteform</p>
      </aside>

      <main className="flex flex-col px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-10">
        <span className="w-fit lg:hidden">
          <Logo />
        </span>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[400px]">{content}</div>
        </div>
      </main>
    </div>
  )
}

function PasswordField(props: {
  value: string
  onChange: (v: string) => void
  show: boolean
  onToggle: () => void
  autoComplete: string
  placeholder: string
  label: string
  extra?: ReactNode
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between px-1">
        <label htmlFor="password" className="text-xs font-semibold">
          {props.label}
        </label>
        {props.extra}
      </div>
      <div className="relative">
        <input
          id="password"
          type={props.show ? 'text' : 'password'}
          required
          minLength={6}
          autoComplete={props.autoComplete}
          placeholder={props.placeholder}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          className={field + ' pr-12'}
        />
        <button
          type="button"
          onClick={props.onToggle}
          aria-label={props.show ? 'Hide password' : 'Show password'}
          className="absolute top-1/2 right-1.5 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full text-dim hover:text-ink"
        >
          {props.show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </button>
      </div>
    </div>
  )
}

function Messages({ error, notice }: { error: string; notice: string }) {
  return (
    <>
      {error && (
        <p
          role="alert"
          className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-2xl border border-signal/30 bg-signal/10 px-4 py-2.5 text-sm text-ink"
        >
          {notice}
        </p>
      )}
    </>
  )
}

function Submit({ busy, label, busyLabel }: { busy: boolean; label: string; busyLabel: string }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="btn-sculpted inline-flex h-12 w-full items-center justify-center gap-2 rounded-full text-[15px] font-semibold disabled:cursor-not-allowed disabled:opacity-70"
    >
      {busy && <Loader2 className="h-5 w-5 animate-spin" />}
      {busy ? busyLabel : label}
    </button>
  )
}
