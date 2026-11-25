import { createFileRoute } from '@tanstack/react-router'
import { AuthScreen, type AuthMode } from '~/features/auth'

type IndexSearch = { mode?: 'signup'; reset?: 1 }

/**
 * The home page is the auth page.
 * - `/?mode=signup` opens on account creation.
 * - `/?reset=1` is where password-reset emails land (asks for a new password).
 * Signed-in users are redirected to /dashboard.
 */
export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): IndexSearch => ({
    ...(search.mode === 'signup' ? { mode: 'signup' } : {}),
    ...(search.reset === 1 || search.reset === '1' ? { reset: 1 } : {}),
  }),
  component: HomePage,
})

function HomePage() {
  const { mode, reset } = Route.useSearch()
  const navigate = Route.useNavigate()

  const setMode = (next: AuthMode) =>
    void navigate({ search: next === 'signup' ? { mode: 'signup' } : {}, replace: true })

  return <AuthScreen mode={mode ?? 'signin'} onModeChange={setMode} resetting={reset === 1} />
}
