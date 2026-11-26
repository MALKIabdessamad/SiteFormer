import { useCallback, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, Check, Coins, FlaskConical, Loader2 } from 'lucide-react'
import { getSupabase } from '~/lib/supabase/client'
import { cn } from '~/lib/utils/cn'
import { toErrorMessage } from '~/lib/utils/errors'
import { buyCredits, changePlan, getBillingMode } from '../api/billing.functions'
import { useAccount } from '../hooks/use-account'
import { CREDIT_PACKS, formatPrice, TOKENS_PER_CREDIT, type PlanId } from '../lib/credits'

type Plan = {
  id: PlanId
  name: string
  price_cents: number
  monthly_credits: number
  max_projects: number
}
type LedgerRow = {
  id: string
  kind: 'signup' | 'plan' | 'pack' | 'run' | 'adjust'
  credits: number
  created_at: string
  plan: PlanId | null
  agent_runs: { prompt: string } | null
}

const FEATURES: Record<PlanId, Array<string>> = {
  free: ['50 credits to start', 'Up to 3 projects', 'Preview, code editor, checkpoints'],
  pro: ['1,000 credits every month', 'Up to 20 projects', 'Everything in Free'],
  max: ['5,000 credits every month', 'Up to 50 projects', 'Everything in Pro'],
}

const date = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

function ledgerLabel(row: LedgerRow): string {
  switch (row.kind) {
    case 'signup':
      return 'Welcome credits'
    case 'plan':
      return `Plan: ${row.plan ? row.plan[0]!.toUpperCase() + row.plan.slice(1) : ''}`
    case 'pack':
      return 'Credit pack'
    case 'run':
      return row.agent_runs?.prompt.replace(/\s+/g, ' ').slice(0, 70) || 'AI message'
    default:
      return 'Adjustment'
  }
}

/** Plans, credit packs and recent credit activity. Purchases are mock until payments go live. */
export function BillingScreen() {
  const { account, refresh, userId } = useAccount()
  const [plans, setPlans] = useState<Array<Plan>>([])
  const [ledger, setLedger] = useState<Array<LedgerRow>>([])
  const [projectCount, setProjectCount] = useState<number | null>(null)
  const [mode, setMode] = useState<'off' | 'mock' | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const load = useCallback(() => {
    if (!userId) return Promise.resolve()
    const supabase = getSupabase()
    return Promise.all([
      supabase
        .from('plans')
        .select('id, name, price_cents, monthly_credits, max_projects')
        .order('sort'),
      supabase
        .from('credit_ledger')
        .select('id, kind, credits, created_at, plan, agent_runs(prompt)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(15),
      supabase.from('projects').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    ]).then(([p, l, c]) => {
      setPlans((p.data ?? []) as Array<Plan>)
      setLedger((l.data ?? []) as unknown as Array<LedgerRow>)
      setProjectCount(c.count ?? 0)
    })
  }, [userId])

  useEffect(() => {
    void load()
    getBillingMode()
      .then((r) => setMode(r.mode))
      .catch(() => setMode('off'))
  }, [load])

  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key)
    setNotice(null)
    try {
      await fn()
      await Promise.all([refresh(), load()])
      setNotice({ kind: 'ok', text: done })
    } catch (err) {
      setNotice({ kind: 'error', text: toErrorMessage(err) })
    } finally {
      setBusy(null)
    }
  }

  const live = mode === 'mock'

  return (
    <main className="min-h-dvh bg-paper px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-16 text-ink sm:px-6">
      <div className="mx-auto w-full max-w-5xl">
        <Link
          to="/dashboard"
          className="inline-flex h-10 items-center gap-2 rounded-full px-3 text-sm text-dim transition-colors hover:bg-ink/[0.06] hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Dashboard
        </Link>

        <header className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-extrabold tracking-[-0.03em] sm:text-4xl">
              Plans & credits
            </h1>
            <p className="mt-1 text-sm text-dim">
              The AI uses credits as it works: 1 credit ≈{' '}
              {TOKENS_PER_CREDIT.toLocaleString('en-US')} AI tokens. A small change usually takes a
              few credits.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border bg-raised px-4 py-3">
            <Coins className="h-5 w-5 text-signal" aria-hidden />
            <div>
              <p className="text-2xl leading-none font-bold tabular-nums">
                {account ? account.credits.toLocaleString('en-US') : '…'}
              </p>
              <p className="mt-1 text-xs text-dim">
                credits · {account?.planName ?? '…'} plan
                {account && projectCount !== null
                  ? ` · ${projectCount}/${account.maxProjects} projects`
                  : ''}
              </p>
            </div>
          </div>
        </header>

        {mode !== null && (
          <p
            role="note"
            className={cn(
              'mt-6 flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm',
              live ? 'border-signal/30 bg-signal/5 text-dim' : 'text-dim',
            )}
          >
            <FlaskConical className="h-4 w-4 shrink-0" aria-hidden />
            {live
              ? 'Test mode: purchases go through without payment.'
              : 'Payments are coming soon. Plans and credit packs can’t be bought yet.'}
          </p>
        )}

        {notice && (
          <p
            role={notice.kind === 'error' ? 'alert' : 'status'}
            className={cn(
              'mt-4 rounded-xl border px-4 py-2.5 text-sm',
              notice.kind === 'error' ? 'border-danger/30 bg-danger/10 text-danger' : 'text-ink',
            )}
          >
            {notice.text}
          </p>
        )}

        <section aria-label="Plans" className="mt-6 grid gap-4 md:grid-cols-3">
          {plans.map((plan) => {
            const current = account?.plan === plan.id
            return (
              <div
                key={plan.id}
                className={cn(
                  'flex flex-col rounded-2xl border bg-raised p-5',
                  current && 'border-signal/50 ring-1 ring-signal/30',
                )}
              >
                <div className="flex items-baseline justify-between">
                  <h2 className="font-display text-xl font-bold">{plan.name}</h2>
                  {current && (
                    <span className="rounded-full bg-signal/15 px-2 py-0.5 text-[11px] font-medium text-signal">
                      Current
                    </span>
                  )}
                </div>
                <p className="mt-2 text-3xl font-bold">
                  {formatPrice(plan.price_cents)}
                  {plan.price_cents > 0 && (
                    <span className="text-sm font-normal text-dim"> /month</span>
                  )}
                </p>
                <ul className="mt-4 flex-1 space-y-2 text-sm text-dim">
                  {FEATURES[plan.id].map((feature) => (
                    <li key={feature} className="flex gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-signal" aria-hidden />
                      {feature}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={current || !live || busy !== null}
                  onClick={() =>
                    void act(
                      `plan:${plan.id}`,
                      () => changePlan({ data: { plan: plan.id } }),
                      plan.id === 'free'
                        ? 'You’re on the Free plan now.'
                        : `You’re on ${plan.name}. ${plan.monthly_credits.toLocaleString('en-US')} credits added.`,
                    )
                  }
                  className={cn(
                    'mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-full text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50',
                    plan.id === 'free' ? 'box-sculpted' : 'btn-sculpted',
                  )}
                >
                  {busy === `plan:${plan.id}` && (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  )}
                  {current
                    ? 'Current plan'
                    : plan.id === 'free'
                      ? 'Switch to Free'
                      : `Get ${plan.name}`}
                </button>
              </div>
            )
          })}
        </section>

        <section aria-labelledby="packs-title" className="mt-10">
          <h2 id="packs-title" className="font-display text-lg font-bold">
            Need more credits?
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {CREDIT_PACKS.map((pack) => (
              <button
                key={pack.id}
                type="button"
                disabled={!live || busy !== null}
                onClick={() =>
                  void act(
                    pack.id,
                    () => buyCredits({ data: { packId: pack.id } }),
                    `${pack.credits.toLocaleString('en-US')} credits added.`,
                  )
                }
                className="flex items-center justify-between rounded-2xl border bg-raised px-4 py-3 text-left transition-colors hover:border-signal/50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[inherit]"
              >
                <span>
                  <span className="block font-semibold">
                    {pack.credits.toLocaleString('en-US')} credits
                  </span>
                  <span className="text-xs text-dim">one-time</span>
                </span>
                <span className="flex items-center gap-2 font-semibold">
                  {busy === pack.id && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  {formatPrice(pack.priceCents)}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section aria-labelledby="activity-title" className="mt-10">
          <h2 id="activity-title" className="font-display text-lg font-bold">
            Recent activity
          </h2>
          {ledger.length === 0 ? (
            <p className="mt-3 text-sm text-dim">No activity yet.</p>
          ) : (
            <ul className="mt-3 divide-y rounded-2xl border bg-raised">
              {ledger.map((row) => (
                <li key={row.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="w-14 shrink-0 text-xs text-faint">{date(row.created_at)}</span>
                  <span className="min-w-0 flex-1 truncate text-dim">{ledgerLabel(row)}</span>
                  <span
                    className={cn(
                      'shrink-0 font-medium tabular-nums',
                      row.credits > 0 ? 'text-signal' : 'text-ink',
                    )}
                  >
                    {row.credits > 0 ? '+' : row.credits === 0 ? '' : '−'}
                    {Math.abs(row.credits).toLocaleString('en-US')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}
