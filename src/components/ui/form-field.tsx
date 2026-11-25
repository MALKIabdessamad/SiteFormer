import type { ReactNode } from 'react'

type FormFieldProps = {
  id: string
  label: string
  /** Optional element shown on the right of the label, e.g. a "Forgot password?" link. */
  action?: ReactNode
  children: ReactNode
}

export function FormField({ id, label, action, children }: FormFieldProps) {
  return (
    <div>
      <div className="mb-1.5 flex min-h-4 items-center justify-between px-1">
        <label htmlFor={id} className="text-xs font-semibold">
          {label}
        </label>
        {action}
      </div>
      {children}
    </div>
  )
}
