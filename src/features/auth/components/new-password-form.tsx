import { useId, useState, type FormEvent } from 'react'
import { KeyRound } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { FormField } from '~/components/ui/form-field'
import { IconBadge } from '~/components/ui/icon-badge'
import { PasswordInput } from '~/components/ui/password-input'
import { useFormStatus } from '../hooks/use-form-status'
import { authService } from '../lib/auth-service'
import { MIN_PASSWORD_LENGTH } from '../lib/constants'
import { FormMessages } from './form-messages'

/** Shown after the user opens a password-reset link. */
export function NewPasswordForm({ email, onDone }: { email?: string; onDone: () => void }) {
  const id = useId()
  const [password, setPassword] = useState('')
  const status = useFormStatus()

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const result = await status.run(() => authService.updatePassword(password))
    if (result?.ok) onDone()
  }

  return (
    <div className="rise">
      <IconBadge>
        <KeyRound className="h-6 w-6" />
      </IconBadge>
      <h1 className="mt-6 text-center font-display text-3xl font-extrabold tracking-[-0.03em]">
        Set a new password
      </h1>
      <p className="mt-2 text-center text-sm text-dim">
        Choose a new password
        {email && (
          <>
            {' for '}
            <span className="font-semibold break-all text-ink">{email}</span>
          </>
        )}
        .
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <FormField id={id} label="New password">
          <PasswordInput
            id={id}
            name="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </FormField>
        <FormMessages error={status.error} notice={status.notice} />
        <Button type="submit" loading={status.pending}>
          {status.pending ? 'Updating…' : 'Update password'}
        </Button>
      </form>
    </div>
  )
}
