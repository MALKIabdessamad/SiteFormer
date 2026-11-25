-- The app server connects with the secret (service role) key. It bypasses Row Level Security
-- but still needs table privileges, which this project does not grant by default.
grant usage on schema public to service_role;
grant select, insert, update, delete on public.projects to service_role;

-- rls_auto_enable() is the platform helper behind the ensure_rls event trigger. The trigger keeps
-- working (event triggers run as the function owner); this only stops anon/signed-in users from
-- calling it as an API endpoint (/rest/v1/rpc/rls_auto_enable).
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- set_updated_at() is a trigger function; nobody needs to call it directly.
revoke execute on function public.set_updated_at() from public, anon, authenticated;
