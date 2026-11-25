import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Spinner } from '~/components/ui/spinner'
import { useAuthSession } from '../hooks/use-auth-session'
import { AFTER_SIGN_IN_PATH } from '../lib/auth-service'
import type { AuthMode } from '../lib/constants'
import { AuthLayout } from './auth-layout'
import { CheckEmail } from './check-email'
import { CredentialsForm } from './credentials-form'
import { NewPasswordForm } from './new-password-form'

type AuthScreenProps = {
  mode: AuthMode
  onModeChange: (mode: AuthMode) => void
  /** True when the user arrived through a password-reset email link. */
  resetting: boolean
}

/**
 * Picks which auth step to show. Signed-in users are sent to the dashboard, except
 * while they are setting a new password after a reset link.
 */
export function AuthScreen({ mode, onModeChange, resetting }: AuthScreenProps) {
  const session = useAuthSession()
  const navigate = useNavigate()
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const goToDashboard = session.status === 'authenticated' && !resetting

  useEffect(() => {
    if (goToDashboard) void navigate({ to: AFTER_SIGN_IN_PATH, replace: true })
  }, [goToDashboard, navigate])

  const content = (() => {
    if (session.status === 'loading' || goToDashboard) {
      return <Spinner label="Checking your session" />
    }
    if (session.status === 'authenticated') {
      return (
        <NewPasswordForm
          email={session.user.email}
          onDone={() => void navigate({ to: AFTER_SIGN_IN_PATH, replace: true })}
        />
      )
    }
    if (pendingEmail) {
      return (
        <CheckEmail
          email={pendingEmail}
          onBack={() => {
            setPendingEmail(null)
            onModeChange('signin')
          }}
        />
      )
    }
    return (
      <CredentialsForm
        mode={mode}
        onModeChange={onModeChange}
        onConfirmationSent={setPendingEmail}
      />
    )
  })()

  return <AuthLayout>{content}</AuthLayout>
}
