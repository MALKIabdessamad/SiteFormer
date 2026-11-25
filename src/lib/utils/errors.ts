/** Turns anything thrown or returned as an error into a message safe to show users. */
export function toErrorMessage(error: unknown): string {
  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return 'Could not reach the server. Check your connection and try again.'
  }
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return 'Something went wrong. Please try again.'
}
