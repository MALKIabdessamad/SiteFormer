import { createFileRoute } from '@tanstack/react-router'
import {
  errorResponse,
  getAgent,
  postCancel,
  postMessage,
  postRecover,
} from '~/lib/server/agent/http.server'

/**
 * The coding agent's chat connection (see src/lib/server/agent/http.server.ts):
 *   POST /api/agent                    send a message (queues a run, streams its log)
 *   GET  /api/agent?threadId=…         hydrate the chat (transcript + active run)
 *   GET  /api/agent?runId=…&offset=…   join / resume a run's live log
 *   POST /api/agent?action=cancel      stop a run
 */
export const Route = createFileRoute('/api/agent')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const action = new URL(request.url).searchParams.get('action')
          if (action === 'cancel') return await postCancel(request)
          if (action === 'recover') return await postRecover(request)
          return await postMessage(request)
        } catch (error) {
          return errorResponse(error)
        }
      },
      GET: async ({ request }) => {
        try {
          return await getAgent(request)
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  },
})
