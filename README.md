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
| `/project/$id` | Project workspace: the AI coding agent's chat + live preview              |

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
- The **prompt is queued as the agent's first run** and starts as soon as the sandbox is ready.
- The project page updates live through **Supabase Realtime** (plus polling while setting up).
- Setup is **idempotent**: an interrupted setup (deploy, crash) resumes when the project page is
  opened; a failed one shows the reason and a _Try again_ button.
- Opening a ready project **wakes** its sandbox (it auto-sleeps after 30 min idle) and makes sure
  the dev server runs. Deleting a project deletes its sandbox first.
- The AI agent runs **on our server, never inside the sandbox** (see `docs/plan-sandbox-agent.md`).

## The AI coding agent

`z-ai/glm-5.3-flash` (OpenRouter, via TanStack AI) edits the project inside its sandbox with tools.
The agent runs **on our server, never inside the sandbox**; the sandbox only executes commands.

```
browser ──POST /api/agent──▶ enqueueRun ──▶ driver (this server process, not the HTTP request)
   ▲                                          │ chat(): tools + memory + compaction + persistence
   └──GET ?runId=&offset= (replay + follow)── run log (memoryStream) ◀── every chunk
```

- **Survives refresh / tab close.** The run is driven by the server; the browser only watches.
  `useChat({ persistence: true })` hydrates the transcript (`GET ?threadId=`) and re-joins the
  live run log on mount. The transcript is saved after **every tool round**.
- **Survives deploys.** On boot, `server.ts` resumes runs left `queued`/`running` (interrupted
  tool calls are closed out so the model can redo them). Opening a project also self-heals.
- **No time limit.** Only safety caps: `AGENT_MAX_STEPS` model turns per run, per-command
  timeouts inside the sandbox. The user can press **Stop** at any time.
- **Rollback.** Every run is bracketed by git commits in the sandbox. Each reply ends with a
  checkpoint card: _Undo these changes_ / _Restore to here_. A restore is a new commit (undoable)
  and adds a note to the transcript so the model knows.
- **Tools:** `update_plan`, `list_files`, `read_file`, `search_code`, `write_file`, `edit_file`
  (exact, with safe fallbacks for quote/escape/indent slips), `delete_path`, `move_path`,
  `run_command`, `restart_dev_server`, `read_dev_logs`, `check_project` (types + preview + dev
  errors), `screenshot`, `inspect_page`, `interact` (headless Chromium **in the sandbox**,
  installed without root), `audit_page` (axe accessibility + SEO + performance),
  `reference_screenshot` (a public site the user names), `view_image` (an upload, a project image
  or an earlier screenshot), `generate_image` (budgeted: `IMAGE_MAX_PER_RUN`), `web_search`
  (budgeted: `SEARCH_MAX_PER_RUN`), `package_docs` (README + exports of the installed version),
  `fetch_url`, `remember`, `forget_memory`.
- **Attachments:** the composer (paperclip, paste, drag & drop) uploads images and text files to
  the private `agent-uploads` bucket via `POST /api/uploads` (magic-byte checked, 10 MB, 6 per
  message). The run copies them into the project (`public/uploads/`, `content/uploads/`; large
  images re-encoded to WebP) and the model sees attached images once.
- **Memory** (`@tanstack/ai-memory`, Supabase adapter): the agent saves durable facts with
  `remember` (no extra model call per turn); up to 8 relevant memories are recalled each turn.
- **Token-light:** stable system prompt (provider prompt cache; ~85% of input tokens were cached
  in tests), windowed reads, capped outputs, find/replace edits, screenshots sent to the model
  once and never stored in the transcript, compaction (`clearToolResults` → `summarizeOldest`)
  above `AGENT_CONTEXT_TOKENS` with checkpoints saved in `agent_metadata`.

Code: `src/lib/server/agent/` (runner, tools, persistence, memory, prompt, http) and
`src/features/agent/` (chat UI).

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
│       ├── components/      # ProjectScreen, ChatPanel, PreviewPanel
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

| Table                       | Columns                                                                                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `projects`                  | `id`, `user_id`, `name`, `prompt`, `status` (`provisioning` · `ready` · `failed`), `sandbox_id`, `preview_url`, `error`, timestamps                                                        |
| `agent_runs`                | One per user message (the queue): `prompt`, `status` (`queued` → `running` → `completed`/`failed`/`aborted`), `checkpoint_before`/`after`, `files_changed`, `record` (usage, cost, errors) |
| `agent_threads`             | The transcript, one row per project (server-only)                                                                                                                                          |
| `agent_metadata`            | Compaction checkpoints (server-only)                                                                                                                                                       |
| `agent_memories`            | What the agent remembers (`project_id` null = user-wide preference)                                                                                                                        |
| Storage `agent-screenshots` | Private bucket; owners read via signed URLs                                                                                                                                                |

RLS: browsers can only `select` their own `projects`, `agent_runs`, `agent_memories` and
`agent_uploads` (and read their own files in the private storage buckets); the
transcript and metadata are server-only; all writes go through the server (secret key).
`projects` and `agent_runs` are in the `supabase_realtime` publication.

## Deploy to Railway

1. Create a service from this GitHub repo. Railway picks up `railway.json` and builds the
   `Dockerfile` (multi-stage Bun image, runs as a non-root user).
2. Variables:
   - **Required:** `SUPABASE_SECRET_KEY`, `AGENT37_API_KEY`, `OPENROUTER_API_KEY` (server-only).
   - Optional: `NAMING_MODEL`, `NAMING_FALLBACK_MODELS`, `STARTER_REPO`, `STARTER_REF`,
     `STARTER_PORT`, `MAX_PROJECTS_PER_USER`, `AGENT_MODEL`, `IMAGE_MODEL`, `IMAGE_MAX_PER_RUN`,
     `SEARCH_MODEL`, `SEARCH_MAX_PER_RUN`,
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

## Logs (Railway)

The server writes one JSON object per line; Railway parses them, so every field is filterable in
the service's **Logs** tab (`LOG_LEVEL` = debug | info | warn | error, default info):

| Filter                         | Shows                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| `@level:error` / `@level:warn` | Problems only (server errors, failed tools, 4xx/5xx)                                     |
| `@runId:<id>`                  | Everything one agent run did: queued, started, each tool, finished (cost, tokens, files) |
| `@projectId:<id>`              | A project's sandbox setup, runs and deletion                                             |
| `@event:agent.tool @ok:false`  | Failed tool calls with the reason                                                        |
| `@event:client.error`          | Errors users hit in the browser (e.g. a screenshot that can't load)                      |
| `@event:http`                  | One line per app request (method, path, status, ms)                                      |

## CI

`.github/workflows/ci.yml` runs format check, lint, typecheck and build on every push to `main`
and on pull requests.
