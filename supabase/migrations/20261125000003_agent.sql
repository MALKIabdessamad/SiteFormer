-- AI coding agent: runs (queue + lifecycle), the chat transcript, chat metadata (compaction
-- checkpoints), long-term memories, and screenshot storage.
--
-- Security model (same as projects):
--   * Every write goes through the app server with the secret key.
--   * Browsers can only READ what they need, and only for their own projects:
--       agent_runs     → status / checkpoints in the UI (+ Realtime)
--       agent_memories → (future) "what the AI remembers" UI
--       screenshots    → images shown in the chat (Storage, private bucket)
--   * agent_threads and agent_metadata have NO browser policies: the transcript is served by the
--     app server after it checks ownership.

-- ---------------------------------------------------------------------------------------------
-- Runs: one per user message. Doubles as the queue ('queued' waits for the sandbox).
-- `record` holds the TanStack RunRecord fields the app never queries on.
-- ---------------------------------------------------------------------------------------------
create table public.agent_runs (
  id                text primary key check (id ~ '^[A-Za-z0-9_-]{8,100}$'),
  project_id        uuid not null references public.projects (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  prompt            text not null check (char_length(prompt) between 1 and 8000),
  status            text not null default 'queued'
                    check (status in ('queued', 'running', 'interrupted', 'completed', 'failed', 'aborted')),
  cancel_requested  boolean,
  checkpoint_before text check (checkpoint_before ~ '^[0-9a-f]{7,40}$'),
  checkpoint_after  text check (checkpoint_after ~ '^[0-9a-f]{7,40}$'),
  files_changed     integer check (files_changed >= 0),
  record            jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  started_at        timestamptz,
  finished_at       timestamptz
);

comment on table public.agent_runs is 'One row per agent run (user message). Server-written.';
comment on column public.agent_runs.record is 'TanStack RunRecord extras (usage, error, lease…).';

create index agent_runs_project_created_idx on public.agent_runs (project_id, created_at desc);
-- At most one active run per project: the agent never edits a sandbox twice at once.
create unique index agent_runs_one_active_per_project
  on public.agent_runs (project_id) where status in ('queued', 'running');

-- ---------------------------------------------------------------------------------------------
-- Transcript: one row per project (threadId = project id). Saved by full replace.
-- ---------------------------------------------------------------------------------------------
create table public.agent_threads (
  project_id uuid primary key references public.projects (id) on delete cascade,
  messages   jsonb not null default '[]'::jsonb check (jsonb_typeof(messages) = 'array'),
  updated_at timestamptz not null default now()
);

comment on table public.agent_threads is 'Canonical chat transcript (TanStack ModelMessage[]). Server-only.';

-- ---------------------------------------------------------------------------------------------
-- Chat metadata (TanStack MetadataStore): compaction checkpoints etc. Server-only.
-- ---------------------------------------------------------------------------------------------
create table public.agent_metadata (
  namespace  text not null check (char_length(namespace) between 1 and 200),
  key        text not null check (char_length(key) between 1 and 500),
  value      jsonb not null,
  revision   bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key (namespace, key)
);

comment on table public.agent_metadata is 'TanStack chat metadata (compaction checkpoints). Server-only.';

-- ---------------------------------------------------------------------------------------------
-- Long-term memory. project_id null = a user-wide preference across all their projects.
-- Lexical recall with the language-neutral "simple" config (works for any language).
-- ---------------------------------------------------------------------------------------------
create table public.agent_memories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  kind       text not null default 'fact' check (kind in ('fact', 'preference', 'decision')),
  content    text not null check (char_length(content) between 3 and 500),
  search     tsvector generated always as (to_tsvector('simple', content)) stored,
  created_at timestamptz not null default now()
);

comment on table public.agent_memories is 'What the agent remembers. project_id null = user-wide.';

create index agent_memories_user_project_idx on public.agent_memories (user_id, project_id, created_at desc);
create index agent_memories_search_idx on public.agent_memories using gin (search);

-- ---------------------------------------------------------------------------------------------
-- updated_at maintenance (reuses public.set_updated_at from the projects migration).
-- ---------------------------------------------------------------------------------------------
create trigger agent_threads_set_updated_at
before update on public.agent_threads
for each row execute function public.set_updated_at();

create trigger agent_metadata_set_updated_at
before update on public.agent_metadata
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------------------------
alter table public.agent_runs enable row level security;
alter table public.agent_threads enable row level security;
alter table public.agent_metadata enable row level security;
alter table public.agent_memories enable row level security;

create policy "Users can read their own agent runs"
on public.agent_runs for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can read their own memories"
on public.agent_memories for select to authenticated
using ((select auth.uid()) = user_id);

-- Least privilege on top of RLS: browsers may only select runs and memories.
revoke all on public.agent_runs, public.agent_threads, public.agent_metadata, public.agent_memories
  from anon, authenticated;
grant select on public.agent_runs, public.agent_memories to authenticated;

-- The app server (secret key) needs full access.
grant select, insert, update, delete
  on public.agent_runs, public.agent_threads, public.agent_metadata, public.agent_memories
  to service_role;

-- Live run status in the browser (Realtime respects RLS).
alter publication supabase_realtime add table public.agent_runs;

-- ---------------------------------------------------------------------------------------------
-- Screenshots: private bucket. Objects live at "<project_id>/<run_id>/<file>.jpg".
-- Owners can read (signed URLs); only the server writes.
-- ---------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('agent-screenshots', 'agent-screenshots', false, 2097152, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy "Users can read screenshots of their own projects"
on storage.objects for select to authenticated
using (
  bucket_id = 'agent-screenshots'
  and exists (
    select 1 from public.projects p
    where p.id::text = (storage.foldername(name))[1]
      and p.user_id = (select auth.uid())
  )
);
