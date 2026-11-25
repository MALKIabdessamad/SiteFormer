import { getSupabase } from '~/lib/supabase/client'

/**
 * Sends a browser-side error to the server logs (visible in Railway as `event: client.error`).
 * Fire-and-forget; never throws. Don't include secrets or full user content.
 */
export function reportClientError(
  context: string,
  message: string,
  extra: { detail?: string; projectId?: string } = {},
) {
  console.warn(`[${context}] ${message}`, extra.detail ?? '')
  void (async () => {
    try {
      const { data } = await getSupabase().auth.getSession()
      const token = data.session?.access_token
      if (!token) return
      await fetch('/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ context, message, page: window.location.pathname, ...extra }),
        keepalive: true,
      })
    } catch {
      /* logging must never break the app */
    }
  })()
}
