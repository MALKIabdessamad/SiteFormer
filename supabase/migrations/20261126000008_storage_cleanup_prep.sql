-- Step 1 of 2 (additive: safe while the previous app version is still serving).
--
-- * agent_messages: the transcript as one row per message (was one jsonb blob per project in
--   agent_threads, rewritten in full after every tool round). Rows are keyed by position and
--   carry a content hash, so a save writes only new or changed messages.
-- * agent_uploads.run_id: the run an upload was sent with (replaces agent_runs.attachments;
--   null = attached but never sent, swept after a day).
-- * agent_metadata.project_id: compaction checkpoints are keyed by thread (= project) id; the
--   foreign key removes them with the project.
-- * agent_metadata.revision: never used.
--
-- Step 2 (20261126000009) backfills and drops agent_threads and agent_runs.attachments once the
-- new app version is live.

create table public.agent_messages (
  project_id uuid not null references public.projects (id) on delete cascade,
  position   integer not null check (position >= 0),
  message    jsonb not null check (jsonb_typeof(message) = 'object'),
  hash       text not null check (char_length(hash) between 1 and 64),
  created_at timestamptz not null default now(),
  primary key (project_id, position)
);

comment on table public.agent_messages is
  'Chat transcript, one TanStack ModelMessage per row in order. Server-only (RLS on, no policies).';

alter table public.agent_messages enable row level security;
revoke all on public.agent_messages from anon, authenticated;
grant select, insert, update, delete on public.agent_messages to service_role;

alter table public.agent_uploads
  add column run_id text references public.agent_runs (id) on delete set null;
create index agent_uploads_run_id_idx on public.agent_uploads (run_id);
create index agent_uploads_unsent_idx on public.agent_uploads (created_at) where run_id is null;

-- Uploads already sent (old column) get their run.
update public.agent_uploads u
set run_id = r.id
from public.agent_runs r
where r.attachments ? u.id::text;

alter table public.agent_metadata
  add column project_id uuid references public.projects (id) on delete cascade;
create index agent_metadata_project_id_idx on public.agent_metadata (project_id);
update public.agent_metadata m
set project_id = m.key::uuid
where m.key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and exists (select 1 from public.projects p where p.id::text = m.key);
delete from public.agent_metadata
where project_id is null
  and key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

alter table public.agent_metadata drop column revision;
