import { createFileRoute } from '@tanstack/react-router'
import { AuthScreen, type AuthMode } from '~/features/auth'

type IndexSearch = { mode?: 'signup' }

/** The home page is the auth page. `/?mode=signup` opens on account creation. */
export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): IndexSearch =>
    search.mode === 'signup' ? { mode: 'signup' } : {},
  component: HomePage,
})

function HomePage() {
  const { mode } = Route.useSearch()
  const navigate = Route.useNavigate()

  const setMode = (next: AuthMode) =>
    void navigate({ search: next === 'signup' ? { mode: 'signup' } : {}, replace: true })

  return <AuthScreen mode={mode ?? 'signin'} onModeChange={setMode} />
}
