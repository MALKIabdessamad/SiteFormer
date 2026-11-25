# Plan: projects, sandboxes and the vibe-coding agent

Status: **built.** Projects, sandboxes, AI naming and the coding agent (runner, tools, memory,
persistence, checkpoints, chat UI) are implemented; see README → “The AI coding agent”. MCP
servers are the next phase.

Sources: the working code in `MALKIabdessamad/siteform` (Agent37 client, agent loop, naming)
and the npm READMEs of `@tanstack/ai*` (the agent37.com and tanstack.com docs could not be
reached from the build container, so the Agent37 items under "Verify first" must be checked
against the real docs before coding).

---

## 1. The flow (what the user sees)

```
/dashboard  ──prompt──▶  createProject()  ──▶  /project/$id
                           │                     │
                           ├─ insert project     ├─ "Setting up your sandbox…" + the queued prompt
                           ├─ queue the prompt   │   (shown as the first user message, greyed "queued")
                           ├─ name it (cheap AI) │
                           └─ start provisioning ┘
                                    │
                         sandbox ready ──▶ worker picks the queued run ──▶ agent streams edits
                                                                          preview iframe reloads
```

1. User types a prompt on `/dashboard` and presses **Build**.
2. Server function `createProject({ prompt })`, all within a single request of about 1 to 2 seconds:
   - inserts `projects` row (`status = 'provisioning'`, temporary name from the prompt),
   - inserts a `runs` row (`status = 'queued'`, `prompt`), which is the queue,
   - fires **naming** (cheap model) and **provisioning** in the background (not awaited),
   - returns `{ projectId }`, and the client navigates to `/project/$id` immediately.
3. Naming finishes in about 1 to 3 seconds and updates `projects.name` (sidebar/title update live).
4. Provisioning finishes in about 30 to 120 seconds and sets `projects.status = 'ready'` and `preview_url`.
5. The moment the sandbox is ready, the worker claims the queued run and the agent starts.
   The user can keep typing meanwhile: extra prompts are queued behind it (FIFO, one run at a time per project).

## 2. Architecture (agent outside the sandbox)

```
Browser ──SSE──▶ Railway (Bun + TanStack Start)                     Agent37 sandbox
                 ├─ agent loop: @tanstack/ai chat()  ── tools ──▶  exec (shell) only
                 │    adapter: @tanstack/ai-openrouter              /home/node/site (TanStack Start
                 │    middleware: persistence, memory, compaction   starter) + dev server :3000
                 ├─ naming: chat() + outputSchema (cheap model)    public port ──▶ preview iframe
                 └─ Supabase (service role): projects, runs, messages, memories
```

- **The agent never runs in the sandbox.** The sandbox is a dumb Linux box: we call its
  `exec` endpoint from narrow tool functions. The Agent37 and OpenRouter keys never leave our server.
- **One process does the work.** The queue worker is in-process (one Railway replica).
  This is fine for v1. Scaling to more than one replica later needs the DB lock described in section 5, which is already planned.
- **Runs survive restarts.** Every step is persisted. On boot the worker re-claims `running`
  runs whose heartbeat is stale and re-queues them, and provisioning is idempotent (resumes where it stopped).

## 3. Verify first (before writing code)

### Agent37 (check against their docs and the dashboard)

- [ ] API key works: `GET https://api.agent37.com/v1/instances` with `Authorization: Bearer`.
- [ ] **Template**: which template has Node/Bun + git + curl (reference used `agent37-base`
      and installs Bun itself; check whether a Bun/Node template exists, since that would remove the Bun install step, which takes about 20s).
- [ ] Create body fields still valid: `template, name, auto_sleep, idle_timeout_seconds,
public_ports: [{port, label}], metadata`. Is `metadata.project_id` searchable (for cleanup)?
- [ ] **Statuses** and real cold-start time (`provisioning → running`, `sleeping`, `stopped`).
      Is there a webhook/event for "running"? If yes, use it instead of polling.
- [ ] **Exec**: `POST https://sandbox.agent37.app/v1/instances/{id}/exec`, header `X-Agent37-Key`,
      body `{command}` gives `{exit_code, stdout, stderr}`. Check the max body size (reference chunks files at
      90 KB), the max runtime per command, stdout truncation, and the `409 while checkpointing` behaviour.
- [ ] Is there a **file write/read API**? If yes, use it instead of base64-over-exec (simpler, faster).
- [ ] **Public port URL**: unguessable but unauthenticated? Does it survive sleep/wake? Does it support websockets (for Vite HMR in the iframe)?
- [ ] **Sleep/wake**: does `exec` auto-wake? Does `~/.agent37/hooks/post-restart.sh` still exist (to restart the dev server after wake)?
- [ ] Limits and pricing: max instances per account, CPU/RAM per template, cost of idle vs sleeping, and the delete behaviour.

### OpenRouter

- [ ] API key; pick **two models**:
  - `NAMING_MODEL`: cheap and fast, structured output (JSON schema) supported.
  - `AGENT_MODEL`: the vibe-coding model, **must support tool calling and streaming**
    (check the model page's "tools" support). Test 1 run of 20+ tool calls.
- [ ] Confirm `openRouterText(modelId)` accepts arbitrary model ids (reference casts it).

### TanStack AI (pin these versions)

| Package                    | Version | Used for                                                                          |
| -------------------------- | ------- | --------------------------------------------------------------------------------- |
| `@tanstack/ai`             | 1.8.0   | `chat()`, `toolDefinition()`, middleware, SSE response                            |
| `@tanstack/ai-openrouter`  | 1.1.2   | `openRouterText(model)` adapter                                                   |
| `@tanstack/ai-react`       | 1.1.1   | `useChat` + `fetchServerSentEvents` in the workspace                              |
| `@tanstack/ai-persistence` | 1.1.0   | `withPersistence`, `defineAIPersistence`, `reconstructChat` (resume after reload) |
| `@tanstack/ai-memory`      | 1.1.0   | `memoryMiddleware` + **custom Supabase adapter** (`recall`/`save`)                |
| `@tanstack/ai-compaction`  | 1.1.0   | keep long sessions inside the context window                                      |
| `@tanstack/ai-mcp`         | 1.3.1   | **phase 2**: let users plug MCP servers (Supabase, Stripe…) into the agent        |

- [ ] `ai-memory` ships adapters for in-memory/redis/mem0/honcho/hindsight only, so we write a
      ~60-line `supabaseMemory()` adapter (lexical recall over a `memories` table) and prove it
      with `@tanstack/ai-memory/testkit`. No Redis, no extra service, which keeps the stack light.
- [ ] Middleware order: `memory → compaction → persistence` (persist what was actually sent).

### Railway / Supabase

- [ ] Bun `idleTimeout: 255` in `server.ts` (SSE streams outlive the default 10s).
- [ ] Railway draining window ≥ 30s so in-flight runs can checkpoint on SIGTERM.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` set on Railway (server only, never `VITE_`).
- [ ] Supabase Realtime enabled on `projects` (live status/name) and `runs` (queue state).

## 4. Tables (4 tables, RLS on all)

```sql
projects
  id uuid pk, user_id uuid → auth.users, name text, prompt text,
  status text check in ('provisioning','ready','failed','archived'),
  sandbox_id text unique, preview_url text, error text,
  created_at, updated_at

runs                       -- the prompt queue + agent run state (one table, no extra queue)
  id uuid pk, project_id → projects on delete cascade, user_id,
  prompt text, status text check in ('queued','running','done','failed','cancelled'),
  heartbeat_at timestamptz, error text, usage jsonb,   -- tokens in/out per run
  created_at, started_at, finished_at
  unique index one_active_run on (project_id) where status = 'running'

messages                   -- chat transcript, written by ai-persistence
  id text pk, project_id → projects cascade, run_id → runs,
  role text, parts jsonb, created_at
  index (project_id, created_at)

memories                   -- long-term memory for ai-memory (per project + per user)
  id uuid pk, user_id, project_id null (null = user-wide preference),
  text text, kind text ('fact','preference','decision'), created_at
  index (project_id), gin(to_tsvector('english', text))   -- lexical recall
```

- RLS: users can `select` their own rows on all four; **all writes go through the server** with the service role.
  Users may `update projects.name` and `delete projects` (cascade). This is least privilege, as in the reference.
- Credits/billing tables are **out of scope** for this phase (add `usage` now, so billing can be added later without a migration of history).

## 5. Queue and locking (kept as light as possible)

- Enqueue = insert `runs(status='queued')`. Nothing else.
- Claim (atomic, safe even with several replicas later). The partial unique index guarantees
  one running run per project:

  ```sql
  update runs set status = 'running', started_at = now(), heartbeat_at = now()
  where id = (
    select id from runs where project_id = $1 and status = 'queued'
    order by created_at limit 1 for update skip locked
  ) returning *;
  ```

- Triggers that try a claim: provisioning finished, a run finished, a new prompt queued while the sandbox is ready, and server boot.
- Heartbeat every 15s while running; on boot, `running` runs with heartbeat older than 60s are set back to `queued`.
- Cancel: client sets `status='cancelled'`; the run's `AbortController` is checked between tool calls.

## 6. Files to add

```
src/
├── routes/
│   ├── _authenticated/project.$projectId.tsx   # workspace: chat + preview iframe
│   └── api/agent.ts                            # GET: reconstructChat (resume) · POST: enqueue prompt
├── features/
│   ├── dashboard/…                             # PromptBox submit → createProject → navigate
│   └── workspace/                              # ChatPanel (useChat), PreviewFrame, StatusBanner
└── lib/
    ├── projects.functions.ts                   # createServerFn: createProject, renameProject, deleteProject
    └── server/                                 # *.server.ts = never bundled for the browser
        ├── env.server.ts                       # validated secrets: AGENT37_API_KEY, OPENROUTER_API_KEY,
        │                                       #   SUPABASE_SERVICE_ROLE_KEY, AGENT_MODEL, NAMING_MODEL
        ├── supabase-admin.server.ts            # service-role client
        ├── auth.server.ts                      # verify bearer token → user (middleware)
        ├── sandbox/
        │   ├── agent37.server.ts               # tiny HTTP client: create/get/start/delete, exec, ports
        │   ├── provision.server.ts             # idempotent: create → wait → starter → install → dev → port
        │   └── starter.ts                      # starter site files (generated from /sandbox/starter)
        ├── ai/
        │   ├── models.server.ts                # openRouterText(AGENT_MODEL), openRouterText(NAMING_MODEL)
        │   ├── naming.server.ts                # chat() + outputSchema, 10s timeout, fallback name
        │   ├── tools.server.ts                 # toolDefinition(): list/read/write/edit/delete, run_check
        │   ├── persistence.server.ts           # defineAIPersistence → messages table
        │   ├── memory.server.ts                # supabaseMemory(): MemoryAdapter (recall/save)
        │   ├── prompt.ts                       # system prompt (stack, rules, how to verify)
        │   └── ai-agent.server.ts              # runAgent(run): chat({ adapter, tools, middleware,
        │                                       #   agentLoopStrategy max ~40 steps }) → SSE + persistence
        └── queue.server.ts                     # enqueue, claim, heartbeat, recover-on-boot
supabase/migrations/0001_projects_runs_messages_memories.sql
sandbox/starter/                                # the TanStack Start starter copied into each sandbox
```

## 7. The agent (lean tool set)

| Tool             | What it does (via `exec` in `/home/node/site`)                     |
| ---------------- | ------------------------------------------------------------------ |
| `list_files`     | `git ls-files` + untracked, capped                                 |
| `read_file`      | file with line numbers, size-capped                                |
| `write_file`     | create/overwrite (path must stay inside the project dir)           |
| `edit_file`      | exact string replace (fails if not found or not unique)            |
| `delete_path`    | remove a file/folder inside the project                            |
| `run_check`      | `tsc --noEmit` + fetch the preview and return console/HTTP errors  |
| `add_dependency` | `bun add <pkg>` with a name allow-pattern, then restart dev server |

- Every tool validates its path (`no ..`, no absolute paths outside the project) and quotes shell args.
- After each run: `git commit` in the sandbox (cheap undo and version history later).
- System prompt = stack facts + rules + recalled memories (from `memoryMiddleware`) + project notes.
- Compaction: drop old tool results first, then evict oldest turns.

## 8. Streaming to the browser

- `POST /api/agent` enqueues, then the browser subscribes. `GET /api/agent?projectId=` uses
  `reconstructChat` to return the saved thread plus a cursor to the active run, so `useChat` tails it.
  A reload mid-answer resumes in place, and a queued prompt just shows as "queued" until claimed.
- Project status/name changes arrive through Supabase Realtime (no polling).

## 9. Build order (each step shippable)

1. **Migration + env**: 4 tables, RLS, service role client, `env.server.ts`.
2. **Agent37 client + provisioning**: script-test: create sandbox, starter, dev server, preview URL.
3. **createProject + naming + queue**: dashboard Build makes a project, navigates, and the name appears.
4. **Workspace UI**: status banner, preview iframe, chat list showing the queued prompt.
5. **Agent loop** (`ai-agent.server.ts`, tools, persistence, SSE): the queued prompt gets built.
6. **Memory + compaction**: `supabaseMemory` adapter + contract test.
7. **Hardening**: recover-on-boot, cancel, delete project (also deletes the sandbox), rate limit.
8. _(phase 2)_ `@tanstack/ai-mcp` user MCP servers, credits/billing, custom domains.

## 10. Decisions needed from you

1. **Models**: which OpenRouter ids for naming and for coding?
2. **Agent37 template**: confirm the template name (Bun preinstalled or not).
3. **Starter**: reuse `siteform/sandbox/starter` (TanStack Start + Tailwind + sections) as-is?
4. **Memory scope**: per-project only, or also user-wide preferences ("I always want dark mode")?
5. **Limits for v1**: max projects per user, max runs/day (no billing yet)?
