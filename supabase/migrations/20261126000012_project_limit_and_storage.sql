-- 1. Plan project limits enforced by the database. The app checks first (for a friendly message),
--    but only this trigger is race-proof: concurrent creates for one user are serialized on the
--    user's plan row, so two parallel requests can't both pass a count check.
create function public.enforce_project_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer;
  v_count integer;
begin
  perform 1 from public.user_plans where user_id = new.user_id for update;
  select p.max_projects into v_max
    from public.user_plans up join public.plans p on p.id = up.plan
   where up.user_id = new.user_id;
  if v_max is null then
    select max_projects into v_max from public.plans where id = 'free';
  end if;
  select count(*) into v_count from public.projects where user_id = new.user_id;
  if v_count >= v_max then
    raise exception 'project_limit' using errcode = 'P0001', hint = v_max::text;
  end if;
  return new;
end;
$$;

create trigger projects_enforce_limit
before insert on public.projects
for each row execute function public.enforce_project_limit();

revoke execute on function public.enforce_project_limit() from public, anon, authenticated;

-- 2. Generated images are stored for the chat next to screenshots and may be WebP/GIF.
update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
       file_size_limit = 5242880
 where id = 'agent-screenshots';

-- 3. Covering indexes for the plan foreign keys (Supabase advisor).
create index user_plans_plan_idx on public.user_plans (plan);
create index credit_ledger_plan_idx on public.credit_ledger (plan);
