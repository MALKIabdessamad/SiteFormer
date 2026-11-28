-- The memory recall (recall_agent_memories) ranks a user's memories (at most 300) with ts_rank and
-- never filters with @@, so this full-text index is never used. The `search` column stays: the
-- ranking reads it.
drop index if exists public.agent_memories_search_idx;
