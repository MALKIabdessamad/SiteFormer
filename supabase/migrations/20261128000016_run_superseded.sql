-- A message the user edited and sent again: its run stays on record (credits, history) but is
-- no longer part of the conversation. The chat lists only runs without superseded_at.
alter table public.agent_runs
  add column superseded_at timestamptz;

comment on column public.agent_runs.superseded_at is
  'When the user edited this run''s message and sent it again (the run left the conversation).';
