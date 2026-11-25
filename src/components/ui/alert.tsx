import type { ReactNode } from 'react'
import { cn } from '~/lib/utils/cn'

const tones = {
  error: 'border-danger/30 bg-danger/10 text-danger',
  info: 'border-signal/30 bg-signal/10 text-ink',
} as const

export function Alert({ tone, children }: { tone: keyof typeof tones; children: ReactNode }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('rounded-2xl border px-4 py-2.5 text-sm', tones[tone])}
    >
      {children}
    </p>
  )
}
