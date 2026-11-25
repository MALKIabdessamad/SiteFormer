import { CheckCircle2, LogOut } from 'lucide-react'
import type { User } from '@supabase/supabase-js'
import { Button } from '~/components/ui/button'
import { IconBadge } from '~/components/ui/icon-badge'
import { useFormStatus } from '../hooks/use-form-status'
import { authService } from '../lib/auth-service'
import { FormMessages } from './form-messages'

export function SignedInCard({ user }: { user: User }) {
  const status = useFormStatus()

  return (
    <div className="rise text-center">
      <IconBadge>
        <CheckCircle2 className="h-6 w-6" />
      </IconBadge>
      <h1 className="mt-6 font-display text-3xl font-extrabold tracking-[-0.03em]">
        You&apos;re signed in
      </h1>
      <p className="mt-3 text-sm text-dim">
        Signed in as <span className="font-semibold break-all text-ink">{user.email}</span>.
      </p>
      <div className="mt-8 space-y-4 text-left">
        <FormMessages error={status.error} notice={status.notice} />
        <Button
          variant="secondary"
          loading={status.pending}
          onClick={() => void status.run(authService.signOut)}
        >
          {!status.pending && <LogOut className="h-4 w-4" aria-hidden />}
          Sign out
        </Button>
      </div>
    </div>
  )
}
