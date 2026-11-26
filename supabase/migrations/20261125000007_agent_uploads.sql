-- Files users attach in the chat (logos, photos, copy for a blog…). Stored privately in Storage at
-- "<project_id>/<upload_id>.<ext>"; at run start they are copied into the project's sandbox.
-- Browsers can read their own rows/files; only the app server writes.

create table public.agent_uploads (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  storage_path text not null unique check (char_length(storage_path) <= 300),
  name         text not null check (char_length(name) between 1 and 200),
  kind         text not null check (kind in ('image', 'document')),
  mime         text not null check (char_length(mime) <= 100),
  size         integer not null check (size > 0 and size <= 10485760),
  -- Where the file was copied in the project (e.g. public/uploads/logo.png), once copied.
  project_path text check (char_length(project_path) <= 300),
  created_at   timestamptz not null default now()
);

comment on table public.agent_uploads is 'Files users attach in the agent chat. Server-written.';

create index agent_uploads_project_id_idx on public.agent_uploads (project_id, created_at desc);
create index agent_uploads_user_id_idx on public.agent_uploads (user_id);

alter table public.agent_uploads enable row level security;

create policy "Users can read their own uploads"
on public.agent_uploads for select to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.agent_uploads from anon, authenticated;
grant select on public.agent_uploads to authenticated;
grant select, insert, update, delete on public.agent_uploads to service_role;

-- Which uploads a run received (copied into the sandbox when the run starts).
alter table public.agent_runs
  add column attachments jsonb not null default '[]'::jsonb
  check (jsonb_typeof(attachments) = 'array');

-- Private bucket. Images, plain text, Markdown, CSV and JSON; 10 MB per file.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'agent-uploads', 'agent-uploads', false, 10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml',
        'text/plain', 'text/markdown', 'text/csv', 'application/json']
)
on conflict (id) do nothing;

-- Owners can read (signed URLs). NOTE: qualify storage.objects.name; inside the subquery an
-- unqualified "name" would resolve to projects.name.
create policy "Users can read uploads of their own projects"
on storage.objects for select to authenticated
using (
  bucket_id = 'agent-uploads'
  and exists (
    select 1 from public.projects p
    where p.id::text = (storage.foldername(storage.objects.name))[1]
      and p.user_id = (select auth.uid())
  )
);
