/**
 * Public, build-time configuration.
 *
 * `VITE_*` variables are inlined into the browser bundle when `vite build` runs, so on
 * Railway they must be set as service variables *before* the build (the Dockerfile
 * declares them as build args). Nothing secret belongs here: the Supabase publishable
 * key is designed to ship to the browser and is protected by Row Level Security.
 */

const DEFAULTS = {
  supabaseUrl: 'https://wuqraxscnshbivgjjyee.supabase.co',
  supabasePublishableKey: 'sb_publishable_94JZqrmRmSFdn8oCyLb4mw_UWRZJn5Z',
} as const

function readUrl(name: string, value: string | undefined, fallback: string): string {
  const resolved = value?.trim() || fallback
  try {
    return new URL(resolved).origin
  } catch {
    throw new Error(`Invalid ${name}: "${resolved}" is not a URL.`)
  }
}

export const env = {
  supabaseUrl: readUrl(
    'VITE_SUPABASE_URL',
    import.meta.env.VITE_SUPABASE_URL,
    DEFAULTS.supabaseUrl,
  ),
  supabasePublishableKey:
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || DEFAULTS.supabasePublishableKey,
} as const
