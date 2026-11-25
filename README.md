# SiteFormer

A [TanStack Start](https://tanstack.com/start) app whose home page (`/`) is the auth page,
with the Siteform look. Auth is handled by Supabase (project `wuqraxscnshbivgjjyee`), and the
app is deployed to Railway.

**Routes**

| Path         | What it is                                                                |
| ------------ | ------------------------------------------------------------------------- |
| `/`          | Auth: sign in, create account (`?mode=signup`), forgot password           |
| `/?reset=1`  | Where password-reset emails land: set a new password, then → `/dashboard` |
| `/dashboard` | Signed-in home (UI only): sidebar + "What site are we building today?"    |

Signed-in users who open `/` go to `/dashboard`; signed-out users who open `/dashboard` go to `/`.
The dashboard is UI only: the prompt box saves a draft but nothing is generated yet, and
Credits / Domains are marked "Soon".

## Stack

Bun · TanStack Start / Router (SSR) · React 19 · Tailwind CSS v4 · Supabase Auth (PKCE) ·
TypeScript (strict) · ESLint · Prettier · Docker on Railway

## Project structure

```
src/
├── routes/                  # File-based routes (thin: compose features only)
│   ├── __root.tsx           # HTML shell, <head>, fonts, global CSS
│   ├── index.tsx            # "/" → <AuthScreen/> (`mode`, `reset` search params)
│   └── _authenticated/      # Client-only layout that requires a user (requireUser guard)
│       ├── route.tsx
│       └── dashboard.tsx    # "/dashboard" → <DashboardScreen/>
├── features/
│   ├── auth/                # Everything auth, exposed through index.ts
│   │   ├── components/      # AuthScreen (step picker), forms, layout, brand panel
│   │   ├── hooks/           # useAuthSession, useRedirectOnSignOut, useFormStatus
│   │   ├── lib/             # authService (→ AuthResult), requireUser guard, copy
│   │   └── index.ts         # Public API: import from '~/features/auth'
│   └── dashboard/           # Dashboard UI
│       ├── components/      # DashboardScreen, AppSidebar, PromptBox, MobileTopBar
│       ├── hooks/           # useSidebar (collapse, mobile drawer, Ctrl/⌘ B, Esc)
│       └── index.ts
├── components/
│   ├── ui/                  # Reusable primitives: Button, Input, PasswordInput, Alert…
│   ├── brand/               # Logo
│   └── not-found.tsx
├── hooks/                   # Shared hooks (useMediaQuery, useIsDesktop)
├── lib/
│   ├── supabase/client.ts   # Browser-only Supabase singleton
│   └── utils/               # cn(), toErrorMessage(), storage (never throws)
├── config/                  # env.ts (validated public env), site.ts (name, meta)
├── styles/globals.css       # Tailwind v4 theme tokens + sculpted utilities
└── router.tsx               # Router factory
server.ts                    # Bun production server: static assets, SSR, /healthz, headers
```

**Conventions**

- Routes stay thin; features own their UI, hooks and data access.
- Components never call the Supabase SDK directly: they go through `authService`, which
  returns `{ ok: true, data } | { ok: false, error }` and never throws.
- The session lives in the browser (localStorage). `/` is server-rendered with a short
  "checking session" state; pages under `_authenticated/` render on the client only.
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
   add `https://<your-domain>/**` (plus `http://localhost:3000/**`) to **Redirect URLs**.
   Confirmation emails link to `/dashboard` and reset emails to `/?reset=1`; Supabase only
   redirects to allowed URLs.

Railway checks `GET /healthz` before routing traffic to a new deploy. On SIGTERM the server stops
accepting connections and drains in-flight requests before exiting.

## CI

`.github/workflows/ci.yml` runs format check, lint, typecheck and build on every push to `main`
and on pull requests.
