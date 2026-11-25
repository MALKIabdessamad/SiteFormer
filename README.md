# SiteFormer

A [TanStack Start](https://tanstack.com/start) app whose home page (`/`) is the auth page,
with the Siteform look. Auth is handled by Supabase (project `wuqraxscnshbivgjjyee`), and the
app is deployed to Railway.

**Routes**

| Path           | What it is                                                                |
| -------------- | ------------------------------------------------------------------------- |
| `/`            | Auth: sign in, create account (`?mode=signup`), forgot password           |
| `/?reset=1`    | Where password-reset emails land: set a new password, then → `/dashboard` |
| `/dashboard`   | Signed-in home: your projects + "What site are we building today?"        |
| `/project/$id` | Project workspace: queued prompt (agent mocked for now) + live preview    |

Signed-in users who open `/` go to `/dashboard`; signed-out users who open `/dashboard` go to `/`.

## How a project is created

```
/dashboard ──Build──▶ createProject()  (≈150 ms, then the browser opens /project/$id)
                        ├─ insert projects row (status "provisioning", name from the prompt)
                        ├─ background: AI names it (OpenRouter NAMING_MODEL, ≈0.5 s)
                        └─ background: Agent37 sandbox ── setup script ── status "ready"
                                         create (≈1 s) · Bun · clone starter · bun install
                                         · bun run dev on :8080 · public preview URL  (≈12 s)
```

- The **starter** is cloned from [`MALKIabdessamad/app`](https://github.com/MALKIabdessamad/app)
  into `/home/node/site` with fresh git history (so the agent can checkpoint later).
- The **prompt stays queued** on the project until the AI agent (next phase) runs it.
- The project page updates live through **Supabase Realtime** (plus polling while setting up).
- Setup is **idempotent**: an interrupted setup (deploy, crash) resumes when the project page is
  opened; a failed one shows the reason and a _Try again_ button.
- Opening a ready project **wakes** its sandbox (it auto-sleeps after 30 min idle) and makes sure
  the dev server runs. Deleting a project deletes its sandbox first.
- The AI agent runs **on our server, never inside the sandbox** (see `docs/plan-sandbox-agent.md`).

## Stack

Bun · TanStack Start / Router (SSR) · React 19 · Tailwind CSS v4 · Supabase (Auth, Postgres,
Realtime) · Agent37 sandboxes · TanStack AI + OpenRouter · TypeScript (strict) · ESLint ·
Prettier · Docker on Railway

## Project structure

```
src/
├── routes/                  # File-based routes (thin: compose features only)
│   ├── __root.tsx           # HTML shell, <head>, fonts, global CSS
│   ├── index.tsx            # "/" → <AuthScreen/> (`mode`, `reset` search params)
│   └── _authenticated/      # Client-only layout that requires a user (requireUser guard)
│       ├── route.tsx
│       ├── dashboard.tsx    # "/dashboard" → <DashboardScreen/>
│       └── project.$projectId.tsx  # "/project/$id" → <ProjectScreen/>
├── features/
│   ├── auth/                # Everything auth, exposed through index.ts
│   │   ├── components/      # AuthScreen (step picker), forms, layout, brand panel
│   │   ├── hooks/           # useAuthSession, useRedirectOnSignOut, useFormStatus
│   │   ├── lib/             # authService (→ AuthResult), requireUser guard, copy
│   │   └── index.ts         # Public API: import from '~/features/auth'
│   ├── dashboard/           # Dashboard UI
│   │   ├── components/      # DashboardScreen, AppSidebar, PromptBox, MobileTopBar
│   │   └── hooks/           # useSidebar (collapse, mobile drawer, Ctrl/⌘ B, Esc)
│   └── projects/            # Projects + sandboxes
│       ├── api/             # projects.functions.ts (server fns: create/open/retry/delete)
│       │                    # projects.queries.ts (browser reads under RLS + Realtime)
│       ├── components/      # ProjectScreen, ChatPanel (agent mocked), PreviewPanel
│       ├── hooks/           # useProjects, useProject (live)
│       └── lib/             # project-name.ts (sanitising), constants
├── components/
│   ├── ui/                  # Reusable primitives: Button, Input, PasswordInput, Alert…
│   ├── brand/               # Logo
│   └── not-found.tsx
├── hooks/                   # Shared hooks (useMediaQuery, useIsDesktop)
├── lib/
│   ├── supabase/client.ts   # Browser-only Supabase singleton
│   ├── utils/               # cn(), toErrorMessage(), storage (never throws)
│   └── server/              # Server-only (*.server.ts can't be imported by browser code)
│       ├── env.server.ts    # Validated secrets
│       ├── auth.server.ts, require-user.ts   # Verify the Supabase access token
│       ├── supabase-admin.server.ts          # Secret-key client (only writer of projects)
│       ├── errors.server.ts # AppError + safely(): only safe messages reach the browser
│       ├── sandbox/         # agent37.server.ts (API client), provision.server.ts (setup)
│       └── ai/              # naming.server.ts (TanStack AI + OpenRouter, structured output)
├── config/                  # env.ts (validated public env), site.ts (name, meta)
├── styles/globals.css       # Tailwind v4 theme tokens + sculpted utilities
└── router.tsx               # Router factory
├── start.ts                 # CSRF + attaches the user's token to server-function calls
server.ts                    # Bun production server: static assets, SSR, /healthz, headers
supabase/migrations/         # Database schema (applied to the SiteFormer project)
scripts/smoke-sandbox.ts     # Live test: naming + real sandbox setup/resume/delete
```

**Conventions**

- Routes stay thin; features own their UI, hooks and data access.
- Components never call the Supabase SDK directly: auth goes through `authService` (never
  throws), project reads through `projects.queries.ts`.
- Writes go through server functions only. Users can **read** their own `projects` rows (RLS);
  the server writes them with the secret key, so nobody can point a project at another user's
  sandbox or fake its status.
- The session lives in the browser (localStorage). `/` is server-rendered with a short
  "checking session" state; pages under `_authenticated/` render on the client only.
- Import across folders with the `~/` alias (`~/components/ui/button`).

## Develop

```bash
bun install
bun run dev          # http://localhost:3000
bun run check        # prettier + eslint + tsc
bun run preview      # production build served by server.ts
bun run smoke        # live sandbox + naming test (creates and deletes one sandbox)
```

Copy `.env.example` to `.env` and fill in the three server secrets: `SUPABASE_SECRET_KEY`,
`AGENT37_API_KEY`, `OPENROUTER_API_KEY`. The auth pages work without them; creating projects
needs them.

## Database

`supabase/migrations/` holds the schema (already applied to the SiteFormer project):

| Table      | Columns                                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `projects` | `id`, `user_id`, `name`, `prompt` (queued), `status` (`provisioning` · `ready` · `failed`), `sandbox_id`, `preview_url`, `error`, timestamps |

RLS: signed-in users can only `select` their own rows; `insert/update/delete` are revoked from
browser roles. The table is in the `supabase_realtime` publication.

## Deploy to Railway

1. Create a service from this GitHub repo. Railway picks up `railway.json` and builds the
   `Dockerfile` (multi-stage Bun image, runs as a non-root user).
2. Variables:
   - **Required:** `SUPABASE_SECRET_KEY`, `AGENT37_API_KEY`, `OPENROUTER_API_KEY` (server-only).
   - Optional: `NAMING_MODEL`, `NAMING_FALLBACK_MODELS`, `STARTER_REPO`, `STARTER_REF`,
     `STARTER_PORT`, `MAX_PROJECTS_PER_USER`,
     `AGENT37_TEMPLATE`, and `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` (inlined into
     the browser bundle at **build** time, so redeploy after changing them). `PORT` is set by
     Railway automatically.
   - Run **one replica**: background setup jobs are tracked in-process (an interrupted job resumes
     when its project page is opened).
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
