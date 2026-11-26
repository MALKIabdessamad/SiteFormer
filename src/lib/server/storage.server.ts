/**
 * Supabase Storage helpers (secret key). Storage objects are not removed by database cascades,
 * so project files are deleted through these.
 */
import { supabaseAdmin } from './supabase-admin.server'

const PAGE = 1000
const REMOVE_BATCH = 100

/** Entries directly under `prefix` (folders have `id: null`), all pages. */
export async function listEntries(
  bucket: string,
  prefix: string,
): Promise<Array<{ name: string; id: string | null }>> {
  const out: Array<{ name: string; id: string | null }> = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabaseAdmin()
      .storage.from(bucket)
      .list(prefix, { limit: PAGE, offset })
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) return out
  }
}

/** Top-level folder names of a bucket (here: project ids). */
export async function listFolders(bucket: string): Promise<Array<string>> {
  return (await listEntries(bucket, '')).filter((e) => e.id === null).map((e) => e.name)
}

/** Every file path under `prefix`, recursively. */
export async function listFiles(bucket: string, prefix: string): Promise<Array<string>> {
  const paths: Array<string> = []
  for (const entry of await listEntries(bucket, prefix)) {
    const path = `${prefix}/${entry.name}`
    if (entry.id === null) paths.push(...(await listFiles(bucket, path)))
    else paths.push(path)
  }
  return paths
}

export async function removeFiles(bucket: string, paths: Array<string>): Promise<void> {
  for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
    const { error } = await supabaseAdmin()
      .storage.from(bucket)
      .remove(paths.slice(i, i + REMOVE_BATCH))
    if (error) throw error
  }
}

/** Deletes everything under `prefix`; returns the number of files removed. */
export async function removeFolder(bucket: string, prefix: string): Promise<number> {
  const paths = await listFiles(bucket, prefix)
  await removeFiles(bucket, paths)
  return paths.length
}
