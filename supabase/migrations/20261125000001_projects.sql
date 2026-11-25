-- Projects: one row per site a user creates. Each project owns one Agent37 sandbox that
-- runs the starter app and serves its live preview.
--
-- Security model:
--   * Users can only READ their own projects (RLS), from the browser.
--   * Every write goes through the app server with the secret (service role) key, so users can
--     never point a project at someone else's sandbox or fake its status.

create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  prompt      text not null check (char_length(prompt) between 1 and 4000),
  status      text not null default 'provisioning'
              check (status in ('provisioning', 'ready', 'failed')),
  sandbox_id  text unique,
  preview_url text,
  error       text check (char_length(error) <= 500),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.projects is 'User sites; each owns one Agent37 sandbox.';
comment on column public.projects.prompt is 'The first prompt, queued until the AI agent runs it.';
comment on column public.projects.sandbox_id is 'Agent37 instance id. Written by the server only.';

-- Sidebar: a user's projects, most recently updated first.
create index projects_user_id_updated_at_idx on public.projects (user_id, updated_at desc);

-- Keep updated_at current on every update.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger projects_set_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

-- Row Level Security: read own rows only. No insert/update/delete policies, so those are
-- denied for anon and authenticated; the service role bypasses RLS.
alter table public.projects enable row level security;

create policy "Users can read their own projects"
on public.projects for select
to authenticated
using ((select auth.uid()) = user_id);

-- Least privilege on top of RLS.
revoke all on public.projects from anon, authenticated;
grant select on public.projects to authenticated;

-- Live status and name updates in the browser (Realtime respects RLS).
alter publication supabase_realtime add table public.projects;
