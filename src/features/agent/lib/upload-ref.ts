/**
 * Messages reference uploaded files as "sf-upload:<id>" parts, never inline bytes. Shared by the
 * browser (sending, rendering) and the server (validating, resolving).
 */
const UPLOAD_SCHEME = 'sf-upload:'

/** The `source` of an image/document part that points at an upload. */
export const uploadSource = (id: string, mimeType: string) => ({
  type: 'url' as const,
  value: `${UPLOAD_SCHEME}${id}`,
  mimeType,
})

/** The upload id a message part references, or null. */
export function uploadIdOf(part: unknown): string | null {
  const source = (part as { source?: { type?: unknown; value?: unknown } } | null)?.source
  return source?.type === 'url' &&
    typeof source.value === 'string' &&
    source.value.startsWith(UPLOAD_SCHEME)
    ? source.value.slice(UPLOAD_SCHEME.length)
    : null
}
