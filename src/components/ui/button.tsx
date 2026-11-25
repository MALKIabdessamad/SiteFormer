import type { ComponentProps } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '~/lib/utils/cn'

const variants = {
  primary: 'btn-sculpted text-[15px]',
  secondary: 'box-sculpted text-sm hover:border-white/35',
} as const

type ButtonProps = ComponentProps<'button'> & {
  variant?: keyof typeof variants
  loading?: boolean
}

export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:cursor-not-allowed disabled:opacity-70',
        variants[variant],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="h-5 w-5 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}
