import { Loader2 } from 'lucide-react'

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="grid place-items-center py-16 text-dim">
      <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
      <span className="sr-only">{label}</span>
    </div>
  )
}
