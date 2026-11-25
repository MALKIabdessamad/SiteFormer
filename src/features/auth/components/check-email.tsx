import { MailCheck } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { IconBadge } from '~/components/ui/icon-badge'

export function CheckEmail({ email, onBack }: { email: string; onBack: () => void }) {
  return (
    <div className="rise text-center" role="status">
      <IconBadge>
        <MailCheck className="h-6 w-6" />
      </IconBadge>
      <h1 className="mt-6 font-display text-3xl font-extrabold tracking-[-0.03em]">
        Check your inbox
      </h1>
      <p className="mt-3 text-sm text-dim">
        We sent a confirmation link to{' '}
        <span className="font-semibold break-all text-ink">{email}</span>. Open it to finish
        creating your account.
      </p>
      <Button variant="secondary" onClick={onBack} className="mt-8">
        Back to sign in
      </Button>
    </div>
  )
}
