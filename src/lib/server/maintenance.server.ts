/**
 * Periodic cleanup of things database cascades can't reach (run at boot and every few hours by
 * server.ts through POST /api/agent?action=maintenance):
 *
 * - Agent37 sandboxes whose project no longer exists (e.g. the user's account was deleted:
 *   projects cascade away, but the sandbox would keep running and billing).
 * - Storage folders (screenshots, uploads) of projects that no longer exist.
 * - Uploads attached in the composer but never sent, after a day.
 *
 * A project row is always created before its sandbox and files, and deleted after them, so
 * "no project row" reliably means orphaned. Nothing is deleted if the project lookup fails.
 */
import { log } from './log.server'
import { supabaseAdmin } from './supabase-admin.server'
import { deleteInstance, listInstances } from './sandbox/agent37.server'
import { removeProjectScreenshots, screenshotProjectFolders } from './agent/screenshots.server'
import { removeProjectUploads, removeUnsentUploads, UPLOAD_BUCKET } from './agent/uploads.server'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const UNSENT_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** The subset of `ids` that are existing projects. Throws if the lookup fails. */
async function existingProjects(ids: Array<string>): Promise<Set<string>> {
  const found = new Set<string>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabaseAdmin()
      .from('projects')
      .select('id')
      .in('id', ids.slice(i, i + 200))
      .returns<Array<{ id: string }>>()
    if (error) throw error
    for (const row of data ?? []) found.add(row.id)
  }
  return found
}

async function uploadProjectFolders(): Promise<Array<string>> {
  const out: Array<string> = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabaseAdmin()
      .storage.from(UPLOAD_BUCKET)
      .list('', { limit: 1000, offset })
    if (error) throw error
    out.push(...(data ?? []).filter((e) => e.id === null).map((e) => e.name))
    if (!data || data.length < 1000) return out
  }
}

async function sweepSandboxes(): Promise<number> {
  const owned = (await listInstances()).filter(
    (i) => UUID.test(i.metadata?.project_id ?? '') && UUID.test(i.metadata?.user_id ?? ''),
  )
  if (!owned.length) return 0
  const live = await existingProjects(owned.map((i) => i.metadata!.project_id!))
  let removed = 0
  for (const instance of owned) {
    if (live.has(instance.metadata!.project_id!)) continue
    await deleteInstance(instance.id)
    removed += 1
    log.info('Orphaned sandbox deleted', {
      event: 'maintenance.sandbox_deleted',
      sandboxId: instance.id,
      projectId: instance.metadata!.project_id,
    })
  }
  return removed
}

async function sweepStorage(): Promise<number> {
  const screenshots = (await screenshotProjectFolders()).filter((f) => UUID.test(f))
  const uploads = (await uploadProjectFolders()).filter((f) => UUID.test(f))
  const live = await existingProjects([...new Set([...screenshots, ...uploads])])
  let removed = 0
  for (const id of screenshots) if (!live.has(id)) removed += await removeProjectScreenshots(id)
  for (const id of uploads) if (!live.has(id)) removed += await removeProjectUploads(id)
  return removed
}

/** Runs every sweep; one failing doesn't stop the others. */
export async function runMaintenance(): Promise<Record<string, number | string>> {
  const result: Record<string, number | string> = {}
  const steps: Array<[string, () => Promise<number>]> = [
    ['sandboxes', sweepSandboxes],
    ['orphanFiles', sweepStorage],
    ['unsentUploads', () => removeUnsentUploads(UNSENT_MAX_AGE_MS)],
  ]
  for (const [name, step] of steps) {
    try {
      result[name] = await step()
    } catch (error) {
      result[name] = 'failed'
      log.error('Maintenance step failed', {
        event: 'maintenance.failed',
        step: name,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  log.info('Maintenance done', { event: 'maintenance.done', ...result })
  return result
}
