import type { ComponentProps } from 'react'
import { cn } from '~/lib/utils/cn'

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-12 w-full rounded-full border bg-ink/[0.04] px-5 text-base text-ink transition outline-none placeholder:text-faint focus:border-signal/70 focus:bg-ink/[0.06] focus-visible:ring-4 focus-visible:ring-signal/20 aria-invalid:border-danger/60',
        className,
      )}
      {...props}
    />
  )
}
