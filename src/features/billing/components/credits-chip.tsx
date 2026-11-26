import { Link } from '@tanstack/react-router'
import { Coins } from 'lucide-react'
import { cn } from '~/lib/utils/cn'
import type { Account } from '../hooks/use-account'

/** Credits left, linking to the billing page. Turns red at zero. */
export function CreditsChip({
  account,
  className,
}: {
  account: Account | null
  className?: string
}) {
  const empty = account !== null && account.credits < 1
  return (
    <Link
      to="/billing"
      title={account ? `${account.planName} plan · credits left` : 'Credits'}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium tabular-nums transition-colors hover:bg-ink/[0.06]',
        empty ? 'border-danger/40 text-danger' : 'text-dim hover:text-ink',
        className,
      )}
    >
      <Coins className="h-3.5 w-3.5" aria-hidden />
      <span>{account === null ? '…' : Math.max(0, account.credits).toLocaleString('en-US')}</span>
      <span className="sr-only">credits left</span>
    </Link>
  )
}
