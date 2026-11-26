/**
 * Plans and credits on the server (secret key). Balances change only through the database
 * functions charge_tokens / grant_credits (atomic, idempotent where it matters).
 */
import { MIN_CREDITS_TO_RUN, type PlanId } from '~/features/billing/lib/credits'
import { AppError } from '../app-error'
import { log } from '../log.server'
import { supabaseAdmin } from '../supabase-admin.server'

export type UserPlan = {
  plan: PlanId
  planName: string
  credits: number
  maxProjects: number
}

/**
 * The user's plan and balance. A database failure is reported as such (never as "no credits"),
 * and a missing row (user created before plans existed) is created on the Free plan.
 */
export async function getUserPlan(userId: string): Promise<UserPlan> {
  const db = supabaseAdmin()
  const read = () =>
    db
      .from('user_plans')
      .select('plan, credits, plans(name, max_projects)')
      .eq('user_id', userId)
      .maybeSingle<{
        plan: PlanId
        credits: number
        plans: { name: string; max_projects: number } | null
      }>()
  let { data, error } = await read()
  if (error) {
    log.error('Reading the plan failed', {
      event: 'billing.read_failed',
      userId,
      error: error.message,
    })
    throw new AppError('Could not check your plan right now. Try again in a moment.', 'unavailable')
  }
  if (!data) {
    const { error: grantError } = await db.rpc('grant_credits', {
      p_user: userId,
      p_kind: 'signup',
      p_plan: null,
      p_credits: 50,
      p_amount_cents: 0,
      p_provider: 'system',
      p_ref: `signup:${userId}`,
    })
    if (grantError) throw new AppError('Your account is not set up yet. Try again.', 'unavailable')
    ;({ data, error } = await read())
    if (error || !data)
      throw new AppError('Your account is not set up yet. Try again.', 'unavailable')
  }
  return {
    plan: data.plan,
    planName: data.plans?.name ?? data.plan,
    credits: data.credits,
    maxProjects: data.plans?.max_projects ?? 3,
  }
}

/** Throws a user-facing error when the balance can't pay for a message. */
export async function requireCredits(userId: string): Promise<UserPlan> {
  const plan = await getUserPlan(userId)
  if (plan.credits < MIN_CREDITS_TO_RUN) {
    throw new AppError('You’re out of credits. Get more credits to keep building.', 'limit')
  }
  return plan
}

/** Charges weighted tokens to a run's owner; returns the new balance. */
export async function chargeTokens(runId: string, tokens: number): Promise<number> {
  const { data, error } = await supabaseAdmin().rpc('charge_tokens', {
    p_run: runId,
    p_tokens: Math.max(0, Math.ceil(tokens)),
  })
  if (error) throw new Error(`Charging credits failed: ${error.message}`)
  return Number(data)
}

/** Adds credits (and for kind 'plan', switches the plan). Idempotent on `ref`. */
export async function grantCredits(input: {
  userId: string
  kind: 'plan' | 'pack' | 'adjust'
  plan: PlanId | null
  credits: number
  amountCents: number
  provider: string
  ref: string
}): Promise<number> {
  const { data, error } = await supabaseAdmin().rpc('grant_credits', {
    p_user: input.userId,
    p_kind: input.kind,
    p_plan: input.plan,
    p_credits: input.credits,
    p_amount_cents: input.amountCents,
    p_provider: input.provider,
    p_ref: input.ref,
  })
  if (error) throw new Error(`Granting credits failed: ${error.message}`)
  return Number(data)
}
