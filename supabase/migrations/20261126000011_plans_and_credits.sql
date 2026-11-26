-- Plans and credits.
--
--   plans         Free / Pro / Max: price, monthly credits, project limit. Readable by everyone.
--   user_plans    One row per user: plan + credit balance (+ sub-credit token remainder).
--   credit_ledger Every credit in or out (signup grant, plan, pack, one row per agent run).
--
-- 10,000 AI tokens = 1 credit. Charging happens in the database (charge_tokens), atomically and
-- per model step, so a crash or a deploy mid-run never skips or double-counts usage. Browsers can
-- only read their own rows; every write goes through these functions with the secret key.

create table public.plans (
  id              text primary key check (id in ('free', 'pro', 'max')),
  name            text not null,
  price_cents     integer not null check (price_cents >= 0),
  monthly_credits integer not null check (monthly_credits >= 0),
  max_projects    integer not null check (max_projects > 0),
  sort            integer not null
);

insert into public.plans (id, name, price_cents, monthly_credits, max_projects, sort) values
  ('free', 'Free', 0, 50, 3, 1),
  ('pro', 'Pro', 2000, 1000, 20, 2),
  ('max', 'Max', 8000, 5000, 50, 3);

create table public.user_plans (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  plan            text not null default 'free' references public.plans (id),
  credits         integer not null default 0 check (credits >= 0),
  token_remainder integer not null default 0 check (token_remainder between 0 and 9999),
  plan_started_at timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger user_plans_set_updated_at
before update on public.user_plans
for each row execute function public.set_updated_at();

create table public.credit_ledger (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  kind         text not null check (kind in ('signup', 'plan', 'pack', 'run', 'adjust')),
  -- Credits added (> 0) or charged (< 0). A run's row accumulates while it runs.
  credits      integer not null,
  tokens       bigint not null default 0 check (tokens >= 0),
  run_id       text references public.agent_runs (id) on delete set null,
  plan         text references public.plans (id),
  amount_cents integer check (amount_cents >= 0),
  provider     text check (char_length(provider) <= 40),
  -- Idempotency key from the payment provider (or 'signup:<user>'): a retried webhook adds once.
  provider_ref text unique check (char_length(provider_ref) <= 200),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index credit_ledger_one_row_per_run on public.credit_ledger (run_id) where kind = 'run';
create index credit_ledger_user_idx on public.credit_ledger (user_id, created_at desc);

alter table public.agent_runs add column credits_used integer not null default 0 check (credits_used >= 0);

-- ------------------------------------------------------------------------------- functions ----

/**
 * Charges `p_tokens` (already weighted) to the run's owner, carrying the sub-credit remainder.
 * The balance never goes below zero. Returns the new balance (the caller stops the run at 0).
 */
create function public.charge_tokens(p_run text, p_tokens bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_total bigint;
  v_charge integer;
  v_balance integer;
begin
  if p_tokens <= 0 then
    select up.credits into v_balance
      from public.agent_runs r join public.user_plans up on up.user_id = r.user_id
     where r.id = p_run;
    return coalesce(v_balance, 0);
  end if;

  select user_id into v_user from public.agent_runs where id = p_run;
  if v_user is null then raise exception 'unknown run %', p_run; end if;

  insert into public.user_plans (user_id) values (v_user) on conflict do nothing;
  select token_remainder + p_tokens into v_total
    from public.user_plans where user_id = v_user for update;

  select least(credits, (v_total / 10000)::integer) into v_charge
    from public.user_plans where user_id = v_user;

  update public.user_plans
     set credits = credits - v_charge,
         token_remainder = (v_total % 10000)::integer
   where user_id = v_user
  returning credits into v_balance;

  insert into public.credit_ledger (user_id, kind, credits, tokens, run_id)
  values (v_user, 'run', -v_charge, p_tokens, p_run)
  on conflict (run_id) where kind = 'run'
  do update set credits = public.credit_ledger.credits - v_charge,
                tokens = public.credit_ledger.tokens + p_tokens,
                updated_at = now();

  update public.agent_runs set credits_used = credits_used + v_charge where id = p_run;
  return v_balance;
end;
$$;

/**
 * Adds credits and, for kind 'plan', switches the plan. Idempotent on p_ref (payment event id).
 * Returns the new balance.
 */
create function public.grant_credits(
  p_user uuid,
  p_kind text,
  p_plan text,
  p_credits integer,
  p_amount_cents integer,
  p_provider text,
  p_ref text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_added boolean;
  v_balance integer;
begin
  if p_kind not in ('signup', 'plan', 'pack', 'adjust') then raise exception 'bad kind'; end if;
  if p_credits < 0 then raise exception 'credits must be >= 0'; end if;
  insert into public.user_plans (user_id) values (p_user) on conflict do nothing;

  insert into public.credit_ledger (user_id, kind, credits, plan, amount_cents, provider, provider_ref)
  values (p_user, p_kind, p_credits, p_plan, p_amount_cents, p_provider, p_ref)
  on conflict (provider_ref) do nothing
  returning true into v_added;

  if coalesce(v_added, false) then
    update public.user_plans
       set credits = credits + p_credits,
           plan = case when p_kind = 'plan' then p_plan else plan end,
           plan_started_at = case when p_kind = 'plan' then now() else plan_started_at end
     where user_id = p_user;
  end if;
  select credits into v_balance from public.user_plans where user_id = p_user;
  return v_balance;
end;
$$;

-- Every new user starts on Free with its credits.
create function public.handle_new_user_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credits integer;
begin
  select monthly_credits into v_credits from public.plans where id = 'free';
  insert into public.user_plans (user_id, plan, credits) values (new.id, 'free', 0)
  on conflict do nothing;
  perform public.grant_credits(new.id, 'signup', null, coalesce(v_credits, 0), 0, 'system',
                               'signup:' || new.id::text);
  return new;
end;
$$;

create trigger on_auth_user_created_plan
after insert on auth.users
for each row execute function public.handle_new_user_plan();

-- Existing users: Free plan with the signup credits.
select public.grant_credits(u.id, 'signup', null, 50, 0, 'system', 'signup:' || u.id::text)
from auth.users u;

-- ------------------------------------------------------------------------------ access ----

alter table public.plans enable row level security;
alter table public.user_plans enable row level security;
alter table public.credit_ledger enable row level security;

create policy "Anyone can read plans" on public.plans for select to anon, authenticated using (true);
create policy "Users can read their own plan" on public.user_plans
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can read their own credit history" on public.credit_ledger
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.plans, public.user_plans, public.credit_ledger from anon, authenticated;
grant select on public.plans to anon, authenticated;
grant select on public.user_plans, public.credit_ledger to authenticated;
grant select, insert, update, delete on public.plans, public.user_plans, public.credit_ledger to service_role;

revoke execute on function public.charge_tokens(text, bigint) from public, anon, authenticated;
revoke execute on function public.grant_credits(uuid, text, text, integer, integer, text, text) from public, anon, authenticated;
revoke execute on function public.handle_new_user_plan() from public, anon, authenticated;
grant execute on function public.charge_tokens(text, bigint) to service_role;
grant execute on function public.grant_credits(uuid, text, text, integer, integer, text, text) to service_role;

-- Live balance in the browser (Realtime respects RLS).
alter publication supabase_realtime add table public.user_plans;
