import { env } from '~/config/env'

/**
 * Tag written on every sandbox this deployment creates: the Supabase project ref (e.g.
 * "wuqraxscnshbivgjjyee"). The cleanup job only touches sandboxes with its own tag, so
 * environments that share one Agent37 account (production, staging, a dev machine) never delete
 * each other's sandboxes.
 */
export function appEnv(): string {
  try {
    return new URL(env.supabaseUrl).hostname.split('.')[0] || 'unknown'
  } catch {
    return 'unknown'
  }
}
