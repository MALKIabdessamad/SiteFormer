import { getSupabase } from '~/lib/supabase/client'

/** What the server returns for a stored upload. */
export type Upload = {
  id: string
  name: string
  kind: 'image' | 'document'
  mime: string
  size: number
  storagePath: string
}

export const MAX_ATTACHMENTS = 6
export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const ACCEPT =
  'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.txt,.md,.markdown,.csv,.json'
export const UPLOAD_SCHEME = 'sf-upload:'

const ALLOWED_EXT = /\.(png|jpe?g|webp|gif|svg|txt|md|markdown|csv|json)$/i

/** Quick client-side check (the server re-checks the real bytes). */
export function checkFile(file: File): string | null {
  if (file.size > MAX_FILE_BYTES) return `${file.name} is over 10 MB.`
  if (file.size === 0) return `${file.name} is empty.`
  if (!ALLOWED_EXT.test(file.name) && !file.type.startsWith('image/')) {
    return `${file.name}: attach images (PNG, JPG, WebP, GIF, SVG) or text (TXT, MD, CSV, JSON).`
  }
  return null
}

/** Uploads one file to a project. Throws an Error with a user-facing message. */
export async function uploadFile(projectId: string, file: File): Promise<Upload> {
  const { data } = await getSupabase().auth.getSession()
  const token = data.session?.access_token
  const form = new FormData()
  form.set('projectId', projectId)
  form.set('file', file, file.name || 'pasted-image.png')
  const response = await fetch('/api/uploads', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  })
  const body = (await response.json().catch(() => ({}))) as Partial<Upload> & { error?: string }
  if (!response.ok || !body.id) throw new Error(body.error ?? 'Upload failed. Try again.')
  return body as Upload
}

/** Message parts referencing uploads (the server resolves and validates them). */
export function uploadParts(uploads: Array<Upload>) {
  return uploads.map((upload) => ({
    type: upload.kind,
    source: { type: 'url' as const, value: `${UPLOAD_SCHEME}${upload.id}`, mimeType: upload.mime },
    metadata: { name: upload.name },
  }))
}
