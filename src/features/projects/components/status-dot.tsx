import { cn } from '~/lib/utils/cn'
import type { ProjectStatus } from '../types'

const LABELS: Record<ProjectStatus, string> = {
  provisioning: 'Setting up sandbox',
  ready: 'Sandbox ready',
  failed: 'Setup failed',
}

export function StatusLine({ status }: { status: ProjectStatus }) {
  return (
    <p role="status" className="flex items-center gap-1.5 text-[11px] text-dim">
      <span
        aria-hidden
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          status === 'ready' && 'bg-signal',
          status === 'failed' && 'bg-danger',
          status === 'provisioning' && 'animate-pulse bg-faint',
        )}
      />
      {LABELS[status]}
    </p>
  )
}
