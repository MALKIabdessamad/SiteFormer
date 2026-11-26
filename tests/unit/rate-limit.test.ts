import { afterEach, expect, setSystemTime, test } from 'bun:test'
import { rateLimiter } from '../../src/lib/server/rate-limit'

afterEach(() => setSystemTime())

test('allows up to the limit per window, per key', () => {
  setSystemTime(new Date('2026-01-01T00:00:00Z'))
  const allow = rateLimiter(2, 60_000)
  expect(allow('a')).toBe(true)
  expect(allow('a')).toBe(true)
  expect(allow('a')).toBe(false)
  expect(allow('b')).toBe(true)
})

test('frees capacity once hits leave the window', () => {
  setSystemTime(new Date('2026-01-01T00:00:00Z'))
  const allow = rateLimiter(1, 60_000)
  expect(allow('a')).toBe(true)
  expect(allow('a')).toBe(false)
  setSystemTime(new Date('2026-01-01T00:01:01Z'))
  expect(allow('a')).toBe(true)
})
