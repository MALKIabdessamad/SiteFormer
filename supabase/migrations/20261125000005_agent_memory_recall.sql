-- Memory recall for the agent: the user's memories for this project plus their user-wide
-- preferences, best text matches first (any word of the query, language-neutral), topped up
-- with the most recent ones. Called only by the app server.
create function public.recall_agent_memories(
  p_user_id uuid,
  p_project_id uuid,
  p_query text,
  p_limit integer default 8
)
returns table (id uuid, kind text, content text, project_id uuid, created_at timestamptz)
language sql
stable
set search_path = ''
as $$
  with words as (
    select string_agg(quote_literal(w) || ':*', ' | ') as q
    from (
      select distinct w
      from regexp_split_to_table(lower(left(coalesce(p_query, ''), 1000)), '[^[:alnum:]]+') as w
      where char_length(w) >= 3
      limit 30
    ) t
  ),
  candidates as (
    select m.id, m.kind, m.content, m.project_id, m.created_at,
           case when (select q from words) is null then 0
                else ts_rank(m.search, to_tsquery('simple', (select q from words))) end as rank
    from public.agent_memories m
    where m.user_id = p_user_id
      and (m.project_id = p_project_id or m.project_id is null)
  )
  select c.id, c.kind, c.content, c.project_id, c.created_at
  from candidates c
  order by c.rank desc, c.created_at desc
  limit least(greatest(p_limit, 1), 20);
$$;

revoke execute on function public.recall_agent_memories(uuid, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.recall_agent_memories(uuid, uuid, text, integer) to service_role;
