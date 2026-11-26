import { z } from 'zod'

/**
 * Server-only configuration (secrets). Never imported by browser code: the `.server.ts`
 * suffix makes the build fail if it is. Validated lazily on first use, so pages that don't
 * need these (the auth page) keep working when a secret is missing.
 */
const schema = z.object({
  /** Supabase secret key (`sb_secret_…`) or legacy service_role JWT. Bypasses RLS. */
  SUPABASE_SECRET_KEY: z.string().min(20),
  AGENT37_API_KEY: z.string().startsWith('sk_'),
  OPENROUTER_API_KEY: z.string().startsWith('sk-or-'),

  /** Cheap, fast OpenRouter model that names new projects. */
  NAMING_MODEL: z.string().min(3).default('google/gemini-2.5-flash-lite'),
  /**
   * Comma-separated fallbacks OpenRouter tries (same request) when NAMING_MODEL is unavailable,
   * e.g. rate-limited upstream. Different providers on purpose.
   */
  NAMING_FALLBACK_MODELS: z
    .string()
    .default('openai/gpt-4.1-nano,mistralai/mistral-small-3.2-24b-instruct')
    .transform((list) =>
      list
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean),
    ),
  /** Agent37 template every sandbox starts from (Node, git, build tools). */
  AGENT37_TEMPLATE: z.string().min(1).default('agent37-base'),
  /** Public git repo cloned into each new sandbox as the user's starter app. */
  STARTER_REPO: z.url().default('https://github.com/MALKIabdessamad/app'),
  /** Port the starter's `bun run dev` listens on (8080 in MALKIabdessamad/app's vite.config). */
  STARTER_PORT: z.coerce.number().int().min(1024).max(65535).default(8080),
  /** Optional branch or tag of STARTER_REPO (default branch when unset). */
  STARTER_REF: z
    .string()
    .regex(/^[\w./-]+$/)
    .optional(),
  /** OpenRouter model of the coding agent (needs tool calling; images-in for screenshots). */
  AGENT_MODEL: z.string().min(3).default('z-ai/glm-5.3-flash'),
  /** How hard the agent thinks per call: off | low | medium | high. */
  AGENT_REASONING: z.enum(['off', 'low', 'medium', 'high']).default('medium'),
  /** Safety cap on model turns per run (runaway protection; there is no time limit). */
  AGENT_MAX_STEPS: z.coerce.number().int().min(10).max(1000).default(150),
  /** Context budget: older tool output is trimmed, then old turns summarized, above this. */
  AGENT_CONTEXT_TOKENS: z.coerce.number().int().min(20_000).max(900_000).default(90_000),
  /** OpenRouter image model for generate_image (~$0.03 per image). */
  IMAGE_MODEL: z.string().min(3).default('google/gemini-3.1-flash-lite-image'),
  /** generate_image calls allowed per run. 0 disables image generation. */
  IMAGE_MAX_PER_RUN: z.coerce.number().int().min(0).max(10).default(2),
  /** Cheap OpenRouter model that runs web searches (OpenRouter web plugin, ~$0.007 each). */
  SEARCH_MODEL: z.string().min(3).default('openai/gpt-4.1-nano'),
  /** web_search calls allowed per run. 0 disables web search. */
  SEARCH_MAX_PER_RUN: z.coerce.number().int().min(0).max(10).default(3),
  /** Cap on projects (= sandboxes) per user. */
  MAX_PROJECTS_PER_USER: z.coerce.number().int().positive().default(20),
})

export type ServerEnv = z.infer<typeof schema>

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

let cached: ServerEnv | undefined

export function serverEnv(): ServerEnv {
  if (cached) return cached
  const raw = { ...process.env }
  // Accept the dashboard's older name for the same key.
  raw.SUPABASE_SECRET_KEY ??= process.env.SUPABASE_SERVICE_ROLE_KEY
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => i.path.join('.')))].join(', ')
    throw new ConfigError(`Missing or invalid server environment variables: ${names}`)
  }
  cached = parsed.data
  return cached
}
