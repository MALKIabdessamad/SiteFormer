-- Indexes for foreign keys (cascading deletes) and the agent_runs RLS filter (user_id).
create index agent_runs_user_id_idx on public.agent_runs (user_id);
create index agent_memories_project_id_idx on public.agent_memories (project_id);

-- agent_threads / agent_metadata intentionally have RLS enabled with no policies: they are
-- server-only (the transcript is served by the app after an ownership check).
comment on table public.agent_threads is
  'Canonical chat transcript (TanStack ModelMessage[]). Server-only: RLS on, no policies by design.';
comment on table public.agent_metadata is
  'TanStack chat metadata (compaction checkpoints). Server-only: RLS on, no policies by design.';
