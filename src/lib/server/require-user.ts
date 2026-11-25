import { createMiddleware } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import { authenticate } from './auth.server'

/**
 * Server-function middleware: rejects anonymous callers and adds `context.user`.
 *
 * Not a `.server.ts` file on purpose: middleware is referenced from client bundles too. Start
 * strips the `.server()` body (and with it the server-only import) from the client build.
 */
export const requireUser = createMiddleware({ type: 'function' }).server(async ({ next }) => {
  const user = await authenticate(getRequestHeader('authorization'))
  return next({ context: { user } })
})
