/**
 * An error whose message is safe to show the user. Plain module (no server-only imports) because
 * server-function validators reference it.
 */
export class AppError extends Error {
  constructor(
    message: string,
    readonly code: 'unauthorized' | 'not_found' | 'limit' | 'invalid' | 'unavailable' = 'invalid',
  ) {
    super(message)
    this.name = 'AppError'
  }
}
