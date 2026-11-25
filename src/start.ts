import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start'
import { getSupabase } from '~/lib/supabase/client'

/**
 * Sends the signed-in user's access token with every server-function call. The server verifies
 * it in `requireUser` (src/lib/server/auth.server.ts).
 */
const attachAuth = createMiddleware({ type: 'function' }).client(async ({ next }) => {
  const { data } = await getSupabase().auth.getSession()
  const token = data.session?.access_token
  return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} })
})

// Defining this file opts out of Start's automatic CSRF protection, so re-add it for
// server functions.
const csrf = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === 'serverFn' })

export const startInstance = createStart(() => ({
  requestMiddleware: [csrf],
  functionMiddleware: [attachAuth],
}))
