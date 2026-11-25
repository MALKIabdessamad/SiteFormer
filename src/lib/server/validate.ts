import type { z } from 'zod'
import { AppError } from './app-error'

/**
 * Server-function input validator that fails with a user-facing message (the first issue's
 * message) instead of Zod's raw JSON issue list.
 */
export function validate<T extends z.ZodType>(schema: T) {
  return (input: unknown): z.output<T> => {
    const result = schema.safeParse(input)
    if (!result.success) throw new AppError(result.error.issues[0]?.message ?? 'Invalid request.')
    return result.data
  }
}
