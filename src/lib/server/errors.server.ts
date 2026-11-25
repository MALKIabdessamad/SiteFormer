import { AppError } from './app-error'
import { ConfigError } from './env.server'

export { AppError }

/**
 * Runs a server-function body and makes sure only safe messages reach the browser:
 * AppErrors pass through, anything else is logged and replaced with a generic message.
 */
export async function safely<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof AppError) throw error
    if (error instanceof ConfigError) {
      console.error(`[${label}] server misconfigured:`, error.message)
      throw new AppError('This feature is not set up on the server yet.', 'unavailable')
    }
    console.error(`[${label}] unexpected error:`, error)
    throw new AppError('Something went wrong. Please try again.', 'unavailable')
  }
}
