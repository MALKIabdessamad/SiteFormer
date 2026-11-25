/** Must match Authentication → Providers → Email → minimum password length in Supabase. */
export const MIN_PASSWORD_LENGTH = 6

export type AuthMode = 'signin' | 'signup'

export const copy = {
  signin: {
    title: 'Welcome back',
    subtitle: 'Sign in to keep building.',
    submit: 'Sign in',
    submitting: 'Signing in…',
    switchPrompt: 'New to Siteform? ',
    switchAction: 'Create an account',
    passwordPlaceholder: 'Your password',
    autoComplete: 'current-password',
  },
  signup: {
    title: 'Create your account',
    subtitle: 'Your first site is free.',
    submit: 'Create account',
    submitting: 'Creating account…',
    switchPrompt: 'Already have an account? ',
    switchAction: 'Sign in',
    passwordPlaceholder: `At least ${MIN_PASSWORD_LENGTH} characters`,
    autoComplete: 'new-password',
  },
} as const satisfies Record<AuthMode, Record<string, string>>
