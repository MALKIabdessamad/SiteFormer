/**
 * Files users attach in the chat (logos, photos, blog copy…).
 *
 *   browser ──POST /api/uploads──▶ validate (owner, size, REAL type from bytes) ──▶ Storage
 *   message ──parts "sf-upload:<id>"──▶ agent_uploads.run_id ──run start──▶ copied into the sandbox
 *     images     → public/uploads/<name>   (large photos optimized to WebP)
 *     documents  → content/uploads/<name>
 *
 * The model sees attached images once (the run's first model call), then only their paths.
 */
import { AppError } from '../app-error'
import { log } from '../log.server'
import { supabaseAdmin } from '../supabase-admin.server'
import {
  relativePath,
  sh,
  shellQuote,
  sitePath,
  writeBytes,
  type SandboxSession,
} from './sandbox-session.server'

export const UPLOAD_BUCKET = 'agent-uploads'
export const UPLOAD_SCHEME = 'sf-upload:'
const MAX_BYTES = 10 * 1024 * 1024
const MAX_PER_PROJECT = 300
/** Raster images above this are re-encoded to WebP (max 2000 px) when copied into the site. */
const OPTIMIZE_ABOVE_BYTES = 600 * 1024

export type UploadKind = 'image' | 'document'
export type UploadRow = {
  id: string
  project_id: string
  user_id: string
  storage_path: string
  name: string
  kind: UploadKind
  mime: string
  size: number
  project_path: string | null
  /** The run this upload was sent with (null = attached but not sent yet). */
  run_id: string | null
  created_at: string
}

type Detected = { kind: UploadKind; mime: string; ext: string }

const TEXT_TYPES: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
}

/** The file's real type, from its bytes (never trust the browser's MIME type). */
export function detectType(bytes: Uint8Array, name: string): Detected | null {
  const b = bytes
  const ascii = (start: number, text: string) =>
    [...text].every((ch, i) => b[start + i] === ch.charCodeAt(0))
  if (b[0] === 0x89 && ascii(1, 'PNG')) return { kind: 'image', mime: 'image/png', ext: 'png' }
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return { kind: 'image', mime: 'image/jpeg', ext: 'jpg' }
  if (ascii(0, 'GIF8')) return { kind: 'image', mime: 'image/gif', ext: 'gif' }
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP'))
    return { kind: 'image', mime: 'image/webp', ext: 'webp' }

  // Text: valid UTF-8 without NUL bytes.
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(0, 200_000))
  } catch {
    return null
  }
  if (text.includes('\0')) return null
  const head = text.trimStart().slice(0, 500).toLowerCase()
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) {
    return { kind: 'image', mime: 'image/svg+xml', ext: 'svg' }
  }
  const ext = name.toLowerCase().split('.').pop() ?? ''
  const mime = TEXT_TYPES[ext]
  return mime ? { kind: 'document', mime, ext: ext === 'markdown' ? 'md' : ext } : null
}

/** A safe, readable file name: "Mon Logo (final).PNG" → "mon-logo-final.png". */
export function safeFileName(name: string, ext: string): string {
  const base = name
    .replace(/\.[^.]*$/, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${base || 'file'}.${ext}`
}

/** Stores an uploaded file for a project the user owns (ownership is checked by the caller). */
export async function saveUpload(input: {
  userId: string
  projectId: string
  name: string
  bytes: Uint8Array
}): Promise<UploadRow> {
  const { userId, projectId, bytes } = input
  if (bytes.byteLength === 0) throw new AppError('That file is empty.')
  if (bytes.byteLength > MAX_BYTES) throw new AppError('Files can be up to 10 MB.')
  const detected = detectType(bytes, input.name)
  if (!detected) {
    throw new AppError(
      'Unsupported file. Attach images (PNG, JPG, WebP, GIF, SVG) or text (TXT, MD, CSV, JSON).',
    )
  }
  const db = supabaseAdmin()
  const { count } = await db
    .from('agent_uploads')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
  if ((count ?? 0) >= MAX_PER_PROJECT)
    throw new AppError('This project has too many files.', 'limit')

  const id = crypto.randomUUID()
  const storagePath = `${projectId}/${id}.${detected.ext}`
  const { error: storageError } = await db.storage
    .from(UPLOAD_BUCKET)
    .upload(storagePath, bytes, { contentType: detected.mime, upsert: false })
  if (storageError) throw new Error(`Upload storage failed: ${storageError.message}`)

  const name =
    input.name
      // eslint-disable-next-line no-control-regex -- strip control characters from file names
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .slice(0, 200) || `file.${detected.ext}`
  const { data, error } = await db
    .from('agent_uploads')
    .insert({
      id,
      project_id: projectId,
      user_id: userId,
      storage_path: storagePath,
      name,
      kind: detected.kind,
      mime: detected.mime,
      size: bytes.byteLength,
    })
    .select('*')
    .single<UploadRow>()
  if (error) {
    await db.storage.from(UPLOAD_BUCKET).remove([storagePath])
    throw error
  }
  log.info('File uploaded', {
    event: 'upload.saved',
    projectId,
    userId,
    kind: detected.kind,
    mime: detected.mime,
    size: bytes.byteLength,
  })
  return data
}

/** Upload ids referenced by message parts ("sf-upload:<id>"), validated against the project. */
export async function resolveUploads(
  ids: Array<string>,
  projectId: string,
  userId: string,
): Promise<Array<UploadRow>> {
  const unique = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/.test(id))
  if (unique.length === 0) return []
  if (unique.length > 6) throw new AppError('Attach up to 6 files per message.')
  const { data, error } = await supabaseAdmin()
    .from('agent_uploads')
    .select('*')
    .in('id', unique)
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .returns<Array<UploadRow>>()
  if (error) throw error
  if ((data ?? []).length !== unique.length)
    throw new AppError('An attached file was not found.', 'not_found')
  // Keep the order the user attached them in.
  return unique.map((id) => data!.find((row) => row.id === id)!)
}

export async function downloadUpload(row: Pick<UploadRow, 'storage_path'>): Promise<Buffer> {
  const { data, error } = await supabaseAdmin()
    .storage.from(UPLOAD_BUCKET)
    .download(row.storage_path)
  if (error || !data)
    throw new Error(`Could not read upload ${row.storage_path}: ${error?.message}`)
  return Buffer.from(await data.arrayBuffer())
}

/** All of a project's uploads (id → row), to map "sf-upload:<id>" parts to project paths. */
export async function projectUploads(projectId: string): Promise<Map<string, UploadRow>> {
  const { data, error } = await supabaseAdmin()
    .from('agent_uploads')
    .select('*')
    .eq('project_id', projectId)
    .returns<Array<UploadRow>>()
  if (error) throw error
  return new Map((data ?? []).map((row) => [row.id, row]))
}

/** Picks a project path that doesn't overwrite an existing file. */
export async function freePath(
  session: SandboxSession,
  dir: string,
  fileName: string,
): Promise<string> {
  const dot = fileName.lastIndexOf('.')
  const stem = fileName.slice(0, dot)
  const ext = fileName.slice(dot)
  const candidates = [fileName, ...Array.from({ length: 20 }, (_, i) => `${stem}-${i + 2}${ext}`)]
  const absolute = candidates.map((name) => sitePath(`${dir}/${name}`))
  const result = await sh(
    session,
    absolute
      .map((p) => `[ -e ${shellQuote(p)} ] || { echo ${shellQuote(p)}; exit 0; }`)
      .join('\n') + '\necho __NONE__',
    { timeoutSeconds: 15 },
  )
  const chosen = result.stdout.trim().split('\n')[0] ?? ''
  if (!chosen || chosen === '__NONE__')
    return sitePath(`${dir}/${stem}-${crypto.randomUUID().slice(0, 8)}${ext}`)
  return chosen
}

/**
 * Copies a run's attachments into the project (idempotent: a file already copied is reused).
 * `optimize` re-encodes large raster images (browser in the sandbox); it may be skipped.
 */
export async function copyUploadsIntoProject(
  session: SandboxSession,
  uploads: Array<UploadRow>,
  optimize: (bytes: Buffer, row: UploadRow) => Promise<Buffer | null>,
): Promise<Array<UploadRow>> {
  const out: Array<UploadRow> = []
  for (const row of uploads) {
    if (row.project_path) {
      const exists = await sh(
        session,
        `test -f ${shellQuote(sitePath(row.project_path))} && echo yes || echo no`,
        {
          timeoutSeconds: 15,
        },
      )
      if (exists.stdout.trim() === 'yes') {
        out.push(row)
        continue
      }
    }
    let bytes = await downloadUpload(row)
    let ext = row.storage_path.split('.').pop() ?? 'bin'
    if (
      row.kind === 'image' &&
      bytes.byteLength > OPTIMIZE_ABOVE_BYTES &&
      ['png', 'jpg', 'webp'].includes(ext)
    ) {
      const smaller = await optimize(bytes, row).catch(() => null)
      if (smaller && smaller.byteLength < bytes.byteLength) {
        bytes = smaller
        ext = 'webp'
      }
    }
    const dir = row.kind === 'image' ? 'public/uploads' : 'content/uploads'
    const absolute = await freePath(session, dir, safeFileName(row.name, ext))
    await writeBytes(session, absolute, bytes)
    const projectPath = relativePath(absolute)
    await supabaseAdmin()
      .from('agent_uploads')
      .update({ project_path: projectPath })
      .eq('id', row.id)
    out.push({ ...row, project_path: projectPath })
  }
  return out
}

/** Marks uploads as sent with a run (the run copies them into the project when it starts). */
export async function attachUploads(runId: string, uploads: Array<UploadRow>): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('agent_uploads')
    .update({ run_id: runId })
    .in(
      'id',
      uploads.map((u) => u.id),
    )
  if (error) throw error
}

async function removePaths(paths: Array<string>): Promise<void> {
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await supabaseAdmin()
      .storage.from(UPLOAD_BUCKET)
      .remove(paths.slice(i, i + 100))
    if (error) throw error
  }
}

/** Removes every uploaded file of a project from Storage (database rows cascade). */
export async function removeProjectUploads(projectId: string): Promise<number> {
  try {
    const paths: Array<string> = []
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabaseAdmin()
        .storage.from(UPLOAD_BUCKET)
        .list(projectId, { limit: 1000, offset })
      if (error) throw error
      paths.push(...(data ?? []).filter((f) => f.id !== null).map((f) => `${projectId}/${f.name}`))
      if (!data || data.length < 1000) break
    }
    await removePaths(paths)
    return paths.length
  } catch (error) {
    log.error('Removing project uploads failed', {
      event: 'uploads.remove_failed',
      projectId,
      error: error instanceof Error ? error.message : String(error),
    })
    return 0
  }
}

/** Deletes uploads that were attached but never sent with a message, older than `maxAgeMs`. */
export async function removeUnsentUploads(maxAgeMs: number): Promise<number> {
  const before = new Date(Date.now() - maxAgeMs).toISOString()
  const { data, error } = await supabaseAdmin()
    .from('agent_uploads')
    .select('id, storage_path')
    .is('run_id', null)
    .lt('created_at', before)
    .limit(500)
    .returns<Array<{ id: string; storage_path: string }>>()
  if (error) throw error
  if (!data?.length) return 0
  await removePaths(data.map((row) => row.storage_path))
  const { error: deleteError } = await supabaseAdmin()
    .from('agent_uploads')
    .delete()
    .in(
      'id',
      data.map((row) => row.id),
    )
  if (deleteError) throw deleteError
  return data.length
}
