import { createFileRoute } from '@tanstack/react-router'
import { errorResponse, postUpload } from '~/lib/server/agent/http.server'

/** POST /api/uploads: attach a file to a project's chat (see uploads.server.ts). */
export const Route = createFileRoute('/api/uploads')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return await postUpload(request)
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  },
})
