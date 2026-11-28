import { useId, useState, type FormEvent } from 'react'
import { Button } from '~/components/ui/button'
import { FormField } from '~/components/ui/form-field'
import { Input } from '~/components/ui/input'
import { PasswordInput } from '~/components/ui/password-input'
import { useFormStatus } from '../hooks/use-form-status'
import { authService } from '../lib/auth-service'
import { copy, MIN_PASSWORD_LENGTH, type AuthMode } from '../lib/constants'
import { FormMessages } from './form-messages'

type CredentialsFormProps = {
  mode: AuthMode
  onModeChange: (mode: AuthMode) => void
  /** Called after sign-up when Supabase needs the user to confirm their email. */
  onConfirmationSent: (email: string) => void
}

/** Sign-in and sign-up form. A successful sign-in is picked up by `useAuthSession`. */
export function CredentialsForm({ mode, onModeChange, onConfirmationSent }: CredentialsFormProps) {
  const ids = { email: useId(), password: useId() }
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const status = useFormStatus()
  const text = copy[mode]

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const credentials = { email: email.trim(), password }
    if (mode === 'signin') {
      await status.run(() => authService.signIn(credentials))
      return
    }
    const result = await status.run(() => authService.signUp(credentials))
    if (result?.ok && result.data.needsConfirmation) onConfirmationSent(credentials.email)
  }

  const handleForgot = async () => {
    const address = email.trim()
    if (!address) return status.setError('Enter your email above first.')
    const result = await status.run(() => authService.sendPasswordReset(address))
    if (result?.ok) status.setNotice('Password reset link sent. Check your email.')
  }

  const switchMode = () => {
    status.reset()
    onModeChange(mode === 'signin' ? 'signup' : 'signin')
  }

  return (
    <div key={mode} className="rise">
      <h1 className="text-center font-display text-4xl leading-tight font-extrabold tracking-[-0.035em]">
        {text.title}
      </h1>
      <p className="mt-2 text-center text-sm text-dim">{text.subtitle}</p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <FormField id={ids.email} label="Email">
          <Input
            id={ids.email}
            type="email"
            name="email"
            required
            autoComplete="email"
            inputMode="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </FormField>

        <FormField
          id={ids.password}
          label="Password"
          action={
            mode === 'signin' && (
              <button
                type="button"
                onClick={handleForgot}
                disabled={status.pending}
                className="text-xs text-dim transition hover:text-ink"
              >
                Forgot password?
              </button>
            )
          }
        >
          <PasswordInput
            id={ids.password}
            name="password"
            required
            minLength={mode === 'signup' ? MIN_PASSWORD_LENGTH : undefined}
            autoComplete={text.autoComplete}
            placeholder={text.passwordPlaceholder}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </FormField>

        <FormMessages error={status.error} notice={status.notice} />

        <Button type="submit" loading={status.pending}>
          {status.pending ? text.submitting : text.submit}
        </Button>
      </form>

      <p className="mt-7 text-center text-sm text-dim">
        {text.switchPrompt}
        <button
          type="button"
          onClick={switchMode}
          className="font-semibold text-ink hover:underline"
        >
          {text.switchAction}
        </button>
      </p>
    </div>
  )
}
