-- Fix: inside the subquery an unqualified `name` resolved to projects.name (the project's display
-- name) instead of storage.objects.name (the file path), so owners could never read their
-- screenshots. Qualify the column explicitly.
drop policy "Users can read screenshots of their own projects" on storage.objects;

create policy "Users can read screenshots of their own projects"
on storage.objects for select to authenticated
using (
  bucket_id = 'agent-screenshots'
  and exists (
    select 1 from public.projects p
    where p.id::text = (storage.foldername(storage.objects.name))[1]
      and p.user_id = (select auth.uid())
  )
);
