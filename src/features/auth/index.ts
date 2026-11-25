// Public API of the auth feature. Import from '~/features/auth', not from its internals.
export { AuthScreen } from './components/auth-screen'
export { useAuthSession, type AuthSession } from './hooks/use-auth-session'
export { authService, type AuthResult, type Credentials } from './lib/auth-service'
export type { AuthMode } from './lib/constants'
