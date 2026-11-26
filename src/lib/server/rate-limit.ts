/**
 * In-process sliding-window rate limits (the app runs as one replica; see README). Expired keys
 * are swept once per window, so memory stays bounded by the number of active users.
 */
export function rateLimiter(limit: number, windowMs = 60_000) {
  const hits = new Map<string, Array<number>>()
  let lastSweep = Date.now()

  return function allow(key: string): boolean {
    const now = Date.now()
    if (now - lastSweep > windowMs) {
      for (const [k, times] of hits) if (now - times[times.length - 1]! >= windowMs) hits.delete(k)
      lastSweep = now
    }
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
    const allowed = recent.length < limit
    if (allowed) recent.push(now)
    hits.set(key, recent)
    return allowed
  }
}
