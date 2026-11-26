-- Step 2 of 2 (apply once the app version using agent_messages / agent_uploads.run_id is live).
--
-- Moves any transcript still in the old one-blob table into agent_messages, then drops the
-- legacy table and the agent_runs.attachments column (replaced by agent_uploads.run_id).
-- The hash written here is a placeholder: the app rewrites such a row once, on its next save.

insert into public.agent_messages (project_id, position, message, hash)
select t.project_id, (e.ordinality - 1)::int, e.message, md5(e.message::text)
from public.agent_threads t
cross join lateral jsonb_array_elements(t.messages) with ordinality as e(message, ordinality)
where jsonb_typeof(e.message) = 'object'
  and not exists (select 1 from public.agent_messages m where m.project_id = t.project_id)
on conflict (project_id, position) do nothing;

drop table public.agent_threads;

alter table public.agent_runs drop column attachments;
