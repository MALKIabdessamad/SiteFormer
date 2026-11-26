-- Run leases: the server process driving a run holds a short, renewed lease on it. Recovery only
-- takes over a run whose lease expired (its process died), with an atomic conditional update, so
-- a run is never driven by two processes at once (a deploy overlap, a second instance, a dev
-- server pointed at the same database).

alter table public.agent_runs
  add column lease_owner text check (char_length(lease_owner) <= 100),
  add column lease_until timestamptz;

comment on column public.agent_runs.lease_owner is 'Server process driving the run. Server-only.';
comment on column public.agent_runs.lease_until is 'Lease expiry; renewed while the run is driven.';
