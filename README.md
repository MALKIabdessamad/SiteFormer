# SiteFormer

A TanStack Start app whose home page (`/`) is the auth page. Its UI is cloned from Siteform.
Auth runs on Supabase (project `wuqraxscnshbivgjjyee`).

- Sign in / create account (email + password)
- Email confirmation screen after sign-up
- Forgot password → reset link → set a new password, all on `/`
- Signed-in state with sign out

## Run

```bash
bun install
bun run dev      # http://localhost:3000
bun run build && bun run start   # production (also /healthz)
```

Supabase URL and publishable key fall back to the SiteFormer project (`src/lib/config.ts`);
override them with `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` (see `.env.example`).

In Supabase → Authentication → URL Configuration, add your app's origin (e.g.
`http://localhost:3000`) to the redirect URLs so confirmation and reset links come back here.
