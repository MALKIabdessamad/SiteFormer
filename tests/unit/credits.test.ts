import { describe, expect, test } from 'bun:test'
import {
  billableTokens,
  CACHED_TOKEN_WEIGHT,
  formatPrice,
} from '../../src/features/billing/lib/credits'

describe('billableTokens', () => {
  test('counts uncached input and output in full', () => {
    expect(billableTokens({ promptTokens: 8000, completionTokens: 2000 })).toBe(10_000)
  })
  test('counts cached input at a tenth', () => {
    const tokens = billableTokens({
      promptTokens: 100_000,
      completionTokens: 1000,
      promptTokensDetails: { cachedTokens: 90_000 },
    })
    expect(tokens).toBe(10_000 + 90_000 * CACHED_TOKEN_WEIGHT + 1000)
  })
  test('never negative, cached never above prompt', () => {
    expect(billableTokens({})).toBe(0)
    expect(billableTokens({ promptTokens: 10, promptTokensDetails: { cachedTokens: 999 } })).toBe(1)
  })
})

test('prices', () => {
  expect(formatPrice(0)).toBe('Free')
  expect(formatPrice(2000)).toBe('$20')
  expect(formatPrice(1999)).toBe('$19.99')
})
