import { Link } from '@tanstack/react-router'

export function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-paper px-5 text-center">
      <div>
        <p className="font-mono text-xs tracking-[0.14em] text-faint uppercase">404</p>
        <h1 className="mt-3 font-display text-4xl font-extrabold tracking-[-0.035em]">
          Page not found
        </h1>
        <p className="mt-3 text-dim">That address doesn&apos;t exist.</p>
        <Link
          to="/"
          className="mt-8 inline-flex h-11 btn-sculpted items-center rounded-full px-6 text-sm font-semibold"
        >
          Back to home
        </Link>
      </div>
    </main>
  )
}
