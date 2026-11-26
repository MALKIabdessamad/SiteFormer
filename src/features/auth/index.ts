// Public API of the auth feature. Import from '~/features/auth', not from its internals.
export { AuthScreen } from './components/auth-screen'
export { useRedirectOnSignOut } from './hooks/use-redirect-on-sign-out'
export { authService } from './lib/auth-service'
export type { AuthMode } from './lib/constants'
export { requireUser } from './lib/require-user'
