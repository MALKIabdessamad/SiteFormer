/**
 * POST /api/log: lets the browser report errors (e.g. a screenshot that can't load) into the
 * server logs, so problems users see show up in Railway. Authenticated, size-capped and
 * rate-limited per user.
 */
import { AppError } from './app-error'
import { authenticate } from './auth.server'
import { log } from './log.server'

const PER_MINUTE = 20
const recent = new Map<string, Array<number>>()

function allow(userId: string): boolean {
  const now = Date.now()
  const hits = (recent.get(userId) ?? []).filter((t) => now - t < 60_000)
  if (hits.length >= PER_MINUTE) return false
  hits.push(now)
  recent.set(userId, hits)
  if (recent.size > 5000) recent.clear() // bound memory
  return true
}

const clip = (value: unknown, max: number) =>
  typeof value === 'string' ? value.slice(0, max) : undefined

export async function postClientLog(request: Request): Promise<Response> {
  const user = await authenticate(request.headers.get('authorization') ?? undefined)
  if (!allow(user.id)) return new Response(null, { status: 429 })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) throw new AppError('Invalid request.')
  log.warn(`Client: ${clip(body.message, 300) ?? 'error'}`, {
    event: 'client.error',
    userId: user.id,
    context: clip(body.context, 80),
    detail: clip(body.detail, 1000),
    projectId: clip(body.projectId, 40),
    page: clip(body.page, 200),
  })
  return new Response(null, { status: 204 })
}
