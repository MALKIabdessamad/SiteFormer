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
  /** Agent37 template every sandbox starts from (Node, git, build tools). */
  AGENT37_TEMPLATE: z.string().min(1).default('agent37-base'),
  /** Public git repo cloned into each new sandbox as the user's starter app. */
  STARTER_REPO: z.url().default('https://github.com/MALKIabdessamad/app'),
  /** Optional branch or tag of STARTER_REPO (default branch when unset). */
  STARTER_REF: z
    .string()
    .regex(/^[\w./-]+$/)
    .optional(),
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
