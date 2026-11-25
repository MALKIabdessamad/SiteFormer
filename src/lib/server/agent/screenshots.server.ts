/**
 * Screenshot files live in the private bucket at "<project_id>/<run_id>/<file>.jpg". Storage
 * objects are not removed by database cascades, so deleting a project removes them here.
 */
import { log } from '../log.server'
import { supabaseAdmin } from '../supabase-admin.server'

export const SCREENSHOT_BUCKET = 'agent-screenshots'
const PAGE = 1000

async function listAll(prefix: string): Promise<Array<{ name: string; id: string | null }>> {
  const out: Array<{ name: string; id: string | null }> = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabaseAdmin()
      .storage.from(SCREENSHOT_BUCKET)
      .list(prefix, { limit: PAGE, offset })
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) return out
  }
}

/** Deletes every screenshot of a project. Never throws (logs instead). Returns the count. */
export async function removeProjectScreenshots(projectId: string): Promise<number> {
  try {
    const paths: Array<string> = []
    for (const entry of await listAll(projectId)) {
      if (entry.id === null) {
        // A run folder: list its files.
        for (const file of await listAll(`${projectId}/${entry.name}`)) {
          if (file.id !== null) paths.push(`${projectId}/${entry.name}/${file.name}`)
        }
      } else {
        paths.push(`${projectId}/${entry.name}`)
      }
    }
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await supabaseAdmin()
        .storage.from(SCREENSHOT_BUCKET)
        .remove(paths.slice(i, i + 100))
      if (error) throw error
    }
    if (paths.length)
      log.info('Project screenshots removed', {
        event: 'screenshots.removed',
        projectId,
        count: paths.length,
      })
    return paths.length
  } catch (error) {
    log.error('Removing project screenshots failed', {
      event: 'screenshots.remove_failed',
      projectId,
      error: error instanceof Error ? error.message : String(error),
    })
    return 0
  }
}
