import { useState } from 'react'
import { Spinner } from '~/components/ui/spinner'
import { useAuthSession } from '../hooks/use-auth-session'
import type { AuthMode } from '../lib/constants'
import { AuthLayout } from './auth-layout'
import { CheckEmail } from './check-email'
import { CredentialsForm } from './credentials-form'
import { NewPasswordForm } from './new-password-form'
import { SignedInCard } from './signed-in-card'

type AuthScreenProps = {
  mode: AuthMode
  onModeChange: (mode: AuthMode) => void
}

/** Picks which auth step to show from the current session and local UI state. */
export function AuthScreen({ mode, onModeChange }: AuthScreenProps) {
  const { session, finishRecovery } = useAuthSession()
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)

  const content = (() => {
    switch (session.status) {
      case 'loading':
        return <Spinner label="Checking your session" />
      case 'authenticated':
        return session.recovering ? (
          <NewPasswordForm email={session.user.email} onDone={finishRecovery} />
        ) : (
          <SignedInCard user={session.user} />
        )
      case 'anonymous':
        return pendingEmail ? (
          <CheckEmail
            email={pendingEmail}
            onBack={() => {
              setPendingEmail(null)
              onModeChange('signin')
            }}
          />
        ) : (
          <CredentialsForm
            mode={mode}
            onModeChange={onModeChange}
            onConfirmationSent={setPendingEmail}
          />
        )
    }
  })()

  return <AuthLayout>{content}</AuthLayout>
}
