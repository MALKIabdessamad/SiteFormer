/**
 * Plan changes and credit packs.
 *
 * MOCK CHECKOUT: with BILLING_MODE=mock these succeed WITHOUT payment (testing only). With
 * BILLING_MODE=off (the default) they're refused. To go live, a payment provider's webhook should
 * call grantCredits() with provider = 'stripe' (or similar) and the provider's event id as `ref`
 * (retries are then safe), and renew plan credits each billing period the same way.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getUserPlan, grantCredits } from '~/lib/server/billing/credits.server'
import { serverEnv } from '~/lib/server/env.server'
import { AppError, safely } from '~/lib/server/errors.server'
import { log } from '~/lib/server/log.server'
import { requireUser } from '~/lib/server/require-user'
import { supabaseAdmin } from '~/lib/server/supabase-admin.server'
import { validate } from '~/lib/server/validate'
import { CREDIT_PACKS } from '../lib/credits'

const PlanInput = validate(z.object({ plan: z.enum(['free', 'pro', 'max']) }))
const PackInput = validate(
  z.object({ packId: z.enum(CREDIT_PACKS.map((p) => p.id) as [string, ...Array<string>]) }),
)

function assertMock() {
  if (serverEnv().BILLING_MODE !== 'mock') {
    throw new AppError('Payments are coming soon.', 'unavailable')
  }
}

/** Whether purchases work here (the billing page shows "coming soon" otherwise). */
export const getBillingMode = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .handler(() => safely('getBillingMode', async () => ({ mode: serverEnv().BILLING_MODE })))

/** (Mock) switches plan. Upgrading adds that plan's monthly credits; Free adds none. */
export const changePlan = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(PlanInput)
  .handler(({ data, context }) =>
    safely('changePlan', async () => {
      assertMock()
      const current = await getUserPlan(context.user.id)
      if (current.plan === data.plan) throw new AppError(`You’re already on ${current.planName}.`)
      const { data: plan, error } = await supabaseAdmin()
        .from('plans')
        .select('id, monthly_credits, price_cents')
        .eq('id', data.plan)
        .single<{ id: 'free' | 'pro' | 'max'; monthly_credits: number; price_cents: number }>()
      if (error) throw error
      const balance = await grantCredits({
        userId: context.user.id,
        kind: 'plan',
        plan: plan.id,
        credits: plan.id === 'free' ? 0 : plan.monthly_credits,
        amountCents: plan.price_cents,
        provider: 'mock',
        ref: `mock_${crypto.randomUUID()}`,
      })
      log.info('Plan changed (mock)', {
        event: 'billing.plan_changed',
        userId: context.user.id,
        from: current.plan,
        to: plan.id,
      })
      return { plan: plan.id, credits: balance }
    }),
  )

/** (Mock) buys a credit pack. */
export const buyCredits = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(PackInput)
  .handler(({ data, context }) =>
    safely('buyCredits', async () => {
      assertMock()
      const pack = CREDIT_PACKS.find((p) => p.id === data.packId)!
      const balance = await grantCredits({
        userId: context.user.id,
        kind: 'pack',
        plan: null,
        credits: pack.credits,
        amountCents: pack.priceCents,
        provider: 'mock',
        ref: `mock_${crypto.randomUUID()}`,
      })
      log.info('Credits bought (mock)', {
        event: 'billing.pack_bought',
        userId: context.user.id,
        credits: pack.credits,
      })
      return { credits: balance }
    }),
  )
