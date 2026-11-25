// Public API of the auth feature. Import from '~/features/auth', not from its internals.
export { AuthScreen } from './components/auth-screen'
export { useAuthSession, type AuthSession } from './hooks/use-auth-session'
export { useRedirectOnSignOut } from './hooks/use-redirect-on-sign-out'
export {
  AFTER_SIGN_IN_PATH,
  authService,
  type AuthResult,
  type Credentials,
} from './lib/auth-service'
export type { AuthMode } from './lib/constants'
export { requireUser } from './lib/require-user'
