/**
 * Credits: 10,000 AI tokens = 1 credit. Shared by the server (charging) and the browser
 * (labels). The database (public.charge_tokens) applies the charge and keeps the balance.
 */

export const TOKENS_PER_CREDIT = 10_000

/**
 * Cached input tokens (the conversation the provider already has in its prompt cache) are
 * counted at a tenth, like providers price them. Without this, a small edit would cost ~50
 * credits because every model step re-sends the whole context.
 */
export const CACHED_TOKEN_WEIGHT = 0.1

/** Paid tools, in token-equivalents. */
export const IMAGE_TOKENS = 30_000 // 3 credits per generated image
export const SEARCH_TOKENS = 10_000 // 1 credit per web search

/** A message needs at least this many credits to start. */
export const MIN_CREDITS_TO_RUN = 1

export type PlanId = 'free' | 'pro' | 'max'

export type Usage = {
  promptTokens?: number
  completionTokens?: number
  promptTokensDetails?: { cachedTokens?: number } | null
}

/** Billable tokens for one model step. */
export function billableTokens(usage: Usage): number {
  const prompt = Math.max(0, usage.promptTokens ?? 0)
  const completion = Math.max(0, usage.completionTokens ?? 0)
  const cached = Math.min(prompt, Math.max(0, usage.promptTokensDetails?.cachedTokens ?? 0))
  return Math.ceil(prompt - cached + cached * CACHED_TOKEN_WEIGHT + completion)
}

/** Credit packs for the (mock) checkout. Replace with real payment products later. */
export const CREDIT_PACKS = [
  { id: 'pack_100', credits: 100, priceCents: 500 },
  { id: 'pack_500', credits: 500, priceCents: 2000 },
  { id: 'pack_2000', credits: 2000, priceCents: 6000 },
] as const
export type CreditPackId = (typeof CREDIT_PACKS)[number]['id']

export function formatPrice(cents: number): string {
  if (cents === 0) return 'Free'
  return `$${cents % 100 === 0 ? cents / 100 : (cents / 100).toFixed(2)}`
}

export function creditsLabel(credits: number): string {
  const n = Math.max(0, Math.floor(credits))
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'credit' : 'credits'}`
}
