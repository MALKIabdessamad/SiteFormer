-- What an upload is for. 'asset': a file the user attached for the site (copied into the project
-- in Build mode). 'sketch': a screenshot of the preview with the user's drawing on it, context for
-- the AI only (never copied into the site).
alter table public.agent_uploads
  add column purpose text not null default 'asset' check (purpose in ('asset', 'sketch'));

comment on column public.agent_uploads.purpose is 'asset (a file for the site) or sketch (the preview with the user''s drawing; context for the AI only). Written by the server.';
