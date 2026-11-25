// Production server for Bun, written to run on Railway (or any container host).
// Serves the built client assets and hands every other request to the TanStack
// Start handler for server rendering.
// Build first with `bun run build`, then `bun run start`.
import { join, normalize } from 'node:path'

const CLIENT_DIR = join(import.meta.dir, 'dist', 'client')
const SERVER_ENTRY = join(import.meta.dir, 'dist', 'server', 'server.js')

// Railway injects PORT and routes public traffic to it.
const port = Number(process.env.PORT ?? 3000)

if (!(await Bun.file(SERVER_ENTRY).exists())) {
  console.error('No build found. Run `bun run build` first.')
  process.exit(1)
}
const app: { fetch: (request: Request) => Response | Promise<Response> } = (
  await import(SERVER_ENTRY)
).default

async function serveStatic(pathname: string): Promise<Response | null> {
  if (pathname === '/' || pathname.endsWith('/')) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null // malformed %-encoding
  }
  const filePath = normalize(join(CLIENT_DIR, decoded))
  if (!filePath.startsWith(CLIENT_DIR + '/')) return null // block path traversal
  const file = Bun.file(filePath)
  if (!(await file.exists())) return null
  const immutable = pathname.startsWith('/assets/')
  return new Response(file, {
    headers: {
      'Cache-Control': immutable
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600',
    },
  })
}

const server = Bun.serve({
  port,
  hostname: '0.0.0.0', // listen on all interfaces so Railway can reach the container
  async fetch(request) {
    const { pathname } = new URL(request.url)

    // Railway polls this to decide the deploy is healthy.
    if (pathname === '/healthz') {
      return new Response('ok', { headers: { 'Cache-Control': 'no-store' } })
    }

    if (request.method === 'GET' || request.method === 'HEAD') {
      const res = await serveStatic(pathname)
      if (res) return res
    }
    return app.fetch(request)
  },
  error(err) {
    console.error(err)
    return new Response('Internal Server Error', { status: 500 })
  },
})

console.log(`Siteform running at ${server.url}`)

// Railway sends SIGTERM on every deploy. Stop taking new connections, let
// in-flight requests finish, then exit. Anything still running after Railway's
// draining window is killed.
let stopping = false
async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  console.log(`${signal} received, shutting down`)
  await server.stop() // graceful: waits for active requests
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
