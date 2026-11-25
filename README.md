# SiteFormer

A [TanStack Start](https://tanstack.com/start) app whose home page (`/`) is the auth page,
with the Siteform look. Auth is handled by Supabase (project `wuqraxscnshbivgjjyee`), and the
app is deployed to Railway.

**Flows:** sign in · create account (`/?mode=signup`) · check-email screen · forgot password →
reset link → set a new password · signed-in state with sign out.

## Stack

Bun · TanStack Start / Router (SSR) · React 19 · Tailwind CSS v4 · Supabase Auth (PKCE) ·
TypeScript (strict) · ESLint · Prettier · Docker on Railway

## Project structure

```
src/
├── routes/                  # File-based routes (thin: compose features only)
│   ├── __root.tsx           # HTML shell, <head>, fonts, global CSS
│   └── index.tsx            # "/" → <AuthScreen/>, `mode` search param
├── features/
│   └── auth/                # Everything auth, exposed through index.ts
│       ├── components/      # AuthScreen (step picker), forms, layout, brand panel
│       ├── hooks/           # useAuthSession (session + recovery), useFormStatus
│       ├── lib/             # authService (Supabase calls → AuthResult), constants/copy
│       └── index.ts         # Public API: import from '~/features/auth'
├── components/
│   ├── ui/                  # Reusable primitives: Button, Input, PasswordInput, Alert…
│   ├── brand/               # Logo
│   └── not-found.tsx
├── lib/
│   ├── supabase/client.ts   # Browser-only Supabase singleton
│   └── utils/               # cn(), toErrorMessage()
├── config/                  # env.ts (validated public env), site.ts (name, meta)
├── styles/globals.css       # Tailwind v4 theme tokens + sculpted utilities
└── router.tsx               # Router factory
server.ts                    # Bun production server: static assets, SSR, /healthz, headers
```

**Conventions**

- Routes stay thin; features own their UI, hooks and data access.
- Components never call the Supabase SDK directly: they go through `authService`, which
  returns `{ ok: true, data } | { ok: false, error }` and never throws.
- The session lives in the browser (localStorage), so the page is server-rendered with a
  short "checking session" state and `useAuthSession` picks the right step on the client.
- Import across folders with the `~/` alias (`~/components/ui/button`).

## Develop

```bash
bun install
bun run dev          # http://localhost:3000
bun run check        # prettier + eslint + tsc
bun run preview      # production build served by server.ts
```

Environment variables are optional locally (see `.env.example`); without them the app uses
the SiteFormer Supabase project.

## Deploy to Railway

1. Create a service from this GitHub repo. Railway picks up `railway.json` and builds the
   `Dockerfile` (multi-stage Bun image, runs as a non-root user).
2. Optional variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. They are inlined
   into the browser bundle at **build** time, so redeploy after changing them. `PORT` is set by
   Railway automatically.
3. Generate a domain under Settings → Networking.
4. In Supabase → Authentication → URL Configuration, set **Site URL** to the Railway domain and
   add it (plus `http://localhost:3000`) to **Redirect URLs**. Confirmation and password-reset
   emails only send users back to allowed URLs.

Railway checks `GET /healthz` before routing traffic to a new deploy. On SIGTERM the server stops
accepting connections and drains in-flight requests before exiting.

## CI

`.github/workflows/ci.yml` runs format check, lint, typecheck and build on every push to `main`
and on pull requests.
