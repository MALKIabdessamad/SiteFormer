-- Build / Chat mode.
--   projects.mode   the mode the user picked in the project's composer (persists per project).
--   agent_runs.mode the mode a run was sent in, so a run resumed after a restart keeps it.
-- In 'chat' the agent can only read the project (enforced on the server: read-only tools).

alter table public.projects
  add column mode text not null default 'build' check (mode in ('build', 'chat'));

alter table public.agent_runs
  add column mode text not null default 'build' check (mode in ('build', 'chat'));

comment on column public.projects.mode is 'Composer mode: build (agent edits) or chat (read-only). Written by the server.';
comment on column public.agent_runs.mode is 'Mode the message was sent in. Written by the server.';
