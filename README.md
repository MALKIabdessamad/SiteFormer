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
- The **editor bridge** (`.siteformer/` + `siteformer()` in `vite.config.ts`, dev only) is kept
  at the current version on every setup, open and restore (`src/lib/server/sandbox/editor/`):
  it tags each JSX element with its source line (`data-sf-loc`, added before TanStack's code
  splitting) and runs a small script in the preview that talks to the editor by postMessage.
- The **prompt is queued as the agent's first run** and starts as soon as the sandbox is ready.
- The project page updates live through **Supabase Realtime** (plus polling while setting up).
- Setup is **idempotent**: an interrupted setup (deploy, crash) resumes when the project page is
  opened; a failed one shows the reason and a _Try again_ button.
- Opening a ready project **wakes** its sandbox (it auto-sleeps after 30 min idle) and makes sure
  the dev server runs; the preview shows only once it answers (meanwhile: "Waking up your
  sandbox", which a quick check never flashes). Deleting a project deletes its sandbox first.
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
- **Build / Chat mode** (the chip next to Send, ⌥P / Alt+P; saved in `projects.mode`, recorded per run
  in `agent_runs.mode`). Chat runs get read-only tools only (read/search files, preview,
  screenshots, research), make no checkpoints and don't copy attachments into the project;
  the server enforces it, not just the UI.
- **Editing tools** (closed by default; the pencil-ruler button next to Publish opens one card
  over the preview, which changes shape smoothly with what you're doing):
  - _Select_: click an element (one at a time); it gets an outline in the page and a small blue
    chip in the message box (its kind and tag), the cursor goes to the message box (phones switch
    to the chat), and it travels with the next message as a line like
    `⌖ <h1> "…" at src/routes/index.tsx:23:9 on /` (the exact JSX location).
  - _Edit text_: click texts on the page and type; the card shows _N text changes · Cancel ·
    Save_. Save writes them all into the code in one checkpoint (Babel finds each element by its
    source line: exact, no AI, so no credits, on any plan) and notes it in the chat. Cancel
    reloads the page. Texts that come from code get _Ask AI_ instead.
  - Leaving a tool (its icon, Esc, or closing the bar) undoes what it started: the selected
    element leaves the message, unsent lines go; changed texts are saved or cancelled first
    (closing the bar cancels them). Esc works from the empty message box too, not once you've
    typed. _Add to chat_ keeps the drawing it adds.
  - _Draw_: draw on the page (_Annotation · Undo · Redo · Clear_), then _Add to chat_. The
    sandbox's browser renders the same page at the same size and scroll with the lines on it, and
    that image is attached to the message (`agent_uploads.purpose = 'sketch'`: shown to the
    model, never copied into the site).
  - Separately, page errors show a calm card with _Fix it_ (never Vite's red overlay), and the
    path bar follows link clicks in the preview.
- **No half-written pages.** While a Build run works, the sandbox's dev server holds back live
  updates (the runner keeps `/tmp/siteformer-hold` current; it lapses on its own 10 min after the
  last command): the preview keeps the last version, says it updates when the AI is done, and
  reloads with the result. Pages opened in their own tab reload too.
- **Queue and suggestions.** Messages typed while the agent works wait in a queue and send when
  it's done; each can be cancelled (deleted) or edited (back into the message box with its files
  and selected element). After each reply, a small model suggests up to three next steps
  (`agent_runs.suggestions`), shown as a row of chips on top of the composer.
- **Code tab.** Everyone can read the code; editing it by hand is part of the paid plans (the
  Free plan shows it view only, and the server refuses a save).
- **Edit your latest message** (pencil next to it once the agent is done or stopped): it opens in
  place; sending it puts the project back to how it was before that message (its run's
  `checkpoint_before`), takes the message and its reply out of the conversation (the run stays
  on record, `agent_runs.superseded_at`), then sends the new version with the same files and
  selected element.
- **Rollback.** Every run is bracketed by git commits in the sandbox. Each reply ends with a
  row of icons: _Revert to this version_ / _Undo latest edit_, plus the credits it used. A restore
  is a new commit (undoable) and adds a note to the transcript so the model knows.
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
├── routes/                     # File-based routes (thin: compose features only)
│   ├── __root.tsx              # HTML shell, <head>, fonts, global CSS
│   ├── index.tsx               # "/" → <AuthScreen/> (`mode`, `reset` search params)
│   ├── _authenticated/         # Client-only layout that requires a user (requireUser guard)
│   │   ├── dashboard.tsx       # "/dashboard" → <DashboardScreen/>
│   │   ├── project.$projectId.tsx  # "/project/$id" → <ProjectScreen/>
│   │   └── billing.tsx         # "/billing" → <BillingScreen/>
│   └── api/                    # agent.ts (chat, cancel, internal recover/maintenance),
│                               # uploads.ts, log.ts (browser error reports)
├── features/                   # Each feature exposes its public API in index.ts
│   ├── auth/                   # Sign in/up/reset: AuthScreen, authService, requireUser guard
│   ├── dashboard/              # DashboardScreen, AppSidebar, PromptBox, MobileTopBar
│   ├── projects/               # ProjectScreen, preview + code tabs, server fns (create/open/
│   │                           # retry/delete, code read/save, site pages, text edits,
│   │                           # drawings), the editing tools (bar, bridge hook), RLS
│   │                           # reads + Realtime; Publish is a placeholder (coming soon)
│   ├── agent/                  # AgentChat, tool steps, attachments, checkpoints (restore),
│   │                           # runs (useAgentRuns), composer (picks, queue); element
│   │                           # reference lines; lib/upload-ref.ts is shared with the server
│   └── billing/                # BillingScreen, CreditsChip, useAccount, (mock) checkout fns;
│                               # lib/credits.ts (credit math) is shared with the server
├── components/                 # ui/ primitives (Button, Input, Alert…), brand/ (Logo)
├── hooks/                      # Shared hooks (useIsDesktop, useDismiss for popovers)
├── lib/
│   ├── supabase/client.ts      # Browser-only Supabase singleton
│   ├── report-error.ts         # Browser errors → server logs (/api/log)
│   ├── utils/                  # cn(), toErrorMessage(), storage (never throws)
│   └── server/                 # Server-only (*.server.ts can't be imported by browser code)
│       ├── env.server.ts       # Validated secrets and settings
│       ├── auth.server.ts, require-user.ts   # Verify the Supabase access token
│       ├── supabase-admin.server.ts          # Secret-key client (the only writer)
│       ├── errors.server.ts    # AppError + safely(): only safe messages reach the browser
│       ├── rate-limit.ts       # Per-user sliding-window limits
│       ├── storage.server.ts   # Storage listing/deletion (files don't cascade)
│       ├── maintenance.server.ts  # Periodic cleanup of orphaned sandboxes/files/uploads
│       ├── billing/            # Plans + credits (charge_tokens / grant_credits)
│       ├── agent/              # Runner (queue, leases, recovery), tools, persistence, memory,
│       │                       # middleware (vision, credits, logging), uploads, screenshots
│       ├── sandbox/            # agent37.server.ts (API client), provision.server.ts (setup),
│       │                       # editor/ (the bridge files written into every sandbox)
│       ├── visual-edit/        # jsx-edit.ts: exact text/class/src edits by source location
│       ├── project-files.server.ts  # The user's own file edits: ownership, paths, reads
│       ├── serial.ts           # One-at-a-time per key (edits of the same file)
│       └── ai/                 # naming.server.ts (project names), suggestions.server.ts
├── config/                     # env.ts (validated public env), site.ts (name, meta)
├── styles/globals.css          # Tailwind v4 theme tokens + sculpted utilities
├── router.tsx                  # Router factory
└── start.ts                    # CSRF + attaches the user's token to server-function calls
server.ts                       # Bun production server: static assets, SSR, /healthz, security
                                # headers, 12 MB body cap, recovery + maintenance timers
supabase/migrations/            # Database schema (applied to the SiteFormer project)
tests/unit/                     # bun test (also run by `bun run check` and CI)
scripts/smoke-sandbox.ts        # Live test: naming + real sandbox setup/resume/delete
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
- Import across folders with the `~/` alias (`~/components/ui/button`). Other features are
  imported through their `index.ts`; the server may import a feature's pure `lib/` module
  (credit math, upload references) but never its components.
- Plan limits are enforced in the database too (project-limit trigger, credit functions), so a
  race between two requests can't get around them.

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
| `agent_messages`            | The transcript, one row per message; a save writes only new/changed rows (server-only)                                                                                                     |
| `agent_metadata`            | Compaction checkpoints, removed with the project (server-only)                                                                                                                             |
| `agent_memories`            | What the agent remembers (`project_id` null = user-wide preference)                                                                                                                        |
| `agent_uploads`             | Files attached in the composer: `run_id` (null = not sent yet), `project_path` once copied into the project                                                                                |
| Storage `agent-screenshots` | Private; screenshots + generated-image copies of the newest 20 runs per project                                                                                                            |
| Storage `agent-uploads`     | Private; attached files. Owners read via signed URLs                                                                                                                                       |

RLS: browsers can only `select` their own `projects`, `agent_runs`, `agent_memories` and
`agent_uploads` (and read their own files in the private storage buckets); the
transcript and metadata are server-only; all writes go through the server (secret key).

**Plans & credits** (`plans`, `user_plans`, `credit_ledger`; migration 11): Free (50 credits,
3 projects), Pro ($20, 1,000 credits/month, 20 projects), Max ($80, 5,000 credits/month,
50 projects). 10,000 AI tokens = 1 credit (cached input tokens count at a tenth); an image costs
3 credits, a web search 1. The database charges after every model step (`charge_tokens`), so a
crash never skips usage; a run stops when the balance hits 0 and new messages need ≥ 1 credit.
`/billing` shows plans, packs and activity. Payments are mocked: `BILLING_MODE=mock` grants
plans/packs without payment (testing only); the default `off` shows "coming soon". To go live, a
payment webhook calls `grantCredits()` with the provider's event id as `ref` (idempotent) and
renews plan credits monthly.

**Cleanup** (`src/lib/server/maintenance.server.ts`, 2 minutes after boot and every 6 hours):
deletes Agent37 sandboxes and storage folders whose project no longer exists (e.g. after an
account is deleted in Supabase) and uploads that were attached but never sent within a day.
`projects` and `agent_runs` are in the `supabase_realtime` publication.

## Deploy to Railway

1. Create a service from this GitHub repo. Railway picks up `railway.json` and builds the
   `Dockerfile` (multi-stage Bun image, runs as a non-root user).
2. Variables:
   - **Required:** `SUPABASE_SECRET_KEY`, `AGENT37_API_KEY`, `OPENROUTER_API_KEY` (server-only).
   - Optional: `NAMING_MODEL`, `NAMING_FALLBACK_MODELS`, `STARTER_REPO`, `STARTER_REF`,
     `STARTER_PORT`, `BILLING_MODE`, `AGENT_MODEL`, `IMAGE_MODEL`, `IMAGE_MAX_PER_RUN`,
     `SEARCH_MODEL`, `SEARCH_MAX_PER_RUN`,
     `AGENT37_TEMPLATE`, and `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` (inlined into
     the browser bundle at **build** time, so redeploy after changing them). `PORT` is set by
     Railway automatically.
   - Run **one replica**: live agent streams, setup jobs and rate limits are in-process (runs
     survive restarts through leases + recovery; an interrupted setup resumes when its project
     page is opened).
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
