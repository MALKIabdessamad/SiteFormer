/**
 * Production server (Bun) for Railway or any container host.
 *
 * - Serves built client assets from dist/client (hashed assets are cached forever).
 * - Hands every other request to the TanStack Start handler for SSR.
 * - Exposes /healthz for Railway's health check.
 * - Adds baseline security headers and shuts down gracefully on SIGTERM.
 * - At boot, resumes AI agent runs a previous process left unfinished (deploys/crashes).
 *
 * Build first with `bun run build`, then `bun run start`.
 */
import { join, normalize } from 'node:path'

const CLIENT_DIR = join(import.meta.dir, 'dist', 'client')
const SERVER_ENTRY = join(import.meta.dir, 'dist', 'server', 'server.js')
const PORT = Number(process.env.PORT ?? 3000) // Railway injects PORT
const IS_PROD = process.env.NODE_ENV === 'production'

if (!(await Bun.file(SERVER_ENTRY).exists())) {
  console.error('No build found. Run `bun run build` first.')
  process.exit(1)
}

// Per-process secret for internal calls into the app (never leaves this process).
process.env.SITEFORMER_INTERNAL_TOKEN = crypto.randomUUID()

type FetchHandler = { fetch: (request: Request) => Response | Promise<Response> }
const app: FetchHandler = (await import(SERVER_ENTRY)).default

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  // Railway terminates TLS, so every public request is HTTPS in production.
  ...(IS_PROD ? { 'Strict-Transport-Security': 'max-age=63072000; includeSubDomains' } : {}),
}

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

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
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
    },
  })
}

let stopping = false

const server = Bun.serve({
  port: PORT,
  hostname: '0.0.0.0', // all interfaces, so Railway's proxy can reach the container
  // Agent progress streams stay open while tools run; 255 s is Bun's maximum. Clients
  // reconnect and resume (Last-Event-ID) if a connection is ever closed.
  idleTimeout: 255,
  async fetch(request) {
    const { pathname } = new URL(request.url)

    if (pathname === '/healthz') {
      return new Response(stopping ? 'stopping' : 'ok', {
        status: stopping ? 503 : 200,
        headers: { 'Cache-Control': 'no-store' },
      })
    }

    if (request.method === 'GET' || request.method === 'HEAD') {
      const asset = await serveStatic(pathname)
      if (asset) return withSecurityHeaders(asset)
    }
    return withSecurityHeaders(await app.fetch(request))
  },
  error(error) {
    console.error(error)
    return new Response('Internal Server Error', { status: 500 })
  },
})

console.log(`Server listening on ${server.url}`)

// Railway sends SIGTERM on every deploy: stop accepting connections, let in-flight
// requests finish, then exit.
async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  console.log(`${signal} received, shutting down`)
  // Let normal requests finish, then close the long-lived agent streams (clients resume them
  // on the new instance; unfinished runs are resumed by its boot recovery).
  const forceClose = setTimeout(() => void server.stop(true), 5000)
  await server.stop()
  clearTimeout(forceClose)
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))

// Resume agent runs left unfinished by the previous process.
void Promise.resolve(
  app.fetch(
    new Request(`http://localhost:${PORT}/api/agent?action=recover`, {
      method: 'POST',
      headers: { 'x-siteformer-internal': process.env.SITEFORMER_INTERNAL_TOKEN! },
    }),
  ),
)
  .then(async (res) => console.log('[agent] boot recovery:', res.status, await res.text()))
  .catch((err) => console.error('[agent] boot recovery failed', err))
process.on('SIGINT', () => void shutdown('SIGINT'))
