import { createFileRoute } from '@tanstack/react-router'
import { errorResponse } from '~/lib/server/agent/http.server'
import { postClientLog } from '~/lib/server/client-log.server'

/** POST /api/log: browser error reports into the server logs (see client-log.server.ts). */
export const Route = createFileRoute('/api/log')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return await postClientLog(request)
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  },
})
