import { useCallback, useRef, useState } from 'react'
import type { AuthResult } from '../lib/auth-service'

type Status = { pending: boolean; error: string; notice: string }

const IDLE: Status = { pending: false, error: '', notice: '' }

/**
 * Pending/error/notice state for a form backed by `authService`.
 * `run` ignores calls while a request is already in flight (double submits).
 */
export function useFormStatus() {
  const [status, setStatus] = useState<Status>(IDLE)
  const inFlight = useRef(false)

  const run = useCallback(
    async <T>(action: () => Promise<AuthResult<T>>): Promise<AuthResult<T> | null> => {
      if (inFlight.current) return null
      inFlight.current = true
      setStatus({ pending: true, error: '', notice: '' })
      try {
        const result = await action()
        setStatus({ pending: false, error: result.ok ? '' : result.error, notice: '' })
        return result
      } finally {
        inFlight.current = false
      }
    },
    [],
  )

  const setError = useCallback((error: string) => setStatus({ ...IDLE, error }), [])
  const setNotice = useCallback((notice: string) => setStatus({ ...IDLE, notice }), [])
  const reset = useCallback(() => setStatus(IDLE), [])

  return { ...status, run, setError, setNotice, reset }
}
