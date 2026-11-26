/**
 * Screenshot files (and copies of generated images) live in the private bucket at
 * "<project_id>/<run_id>/<file>". Deleting a project removes them; otherwise only the newest
 * KEEP_RUNS runs keep theirs (older ones show as "cleared" in the chat).
 */
import { errorFields, log } from '../log.server'
import { listEntries, listFiles, removeFiles, removeFolder } from '../storage.server'
import { supabaseAdmin } from '../supabase-admin.server'

export const SCREENSHOT_BUCKET = 'agent-screenshots'
const KEEP_RUNS = 20

/** Deletes every screenshot of a project. Never throws (logs instead). Returns the count. */
export async function removeProjectScreenshots(projectId: string): Promise<number> {
  try {
    const count = await removeFolder(SCREENSHOT_BUCKET, projectId)
    if (count)
      log.info('Project screenshots removed', { event: 'screenshots.removed', projectId, count })
    return count
  } catch (error) {
    log.error('Removing project screenshots failed', {
      event: 'screenshots.remove_failed',
      projectId,
      ...errorFields(error),
    })
    return 0
  }
}

/**
 * Deletes the screenshots of all but the project's newest KEEP_RUNS runs (and of runs that no
 * longer exist). Never throws. Returns the number of files removed.
 */
export async function pruneProjectScreenshots(projectId: string): Promise<number> {
  try {
    const { data: runs, error } = await supabaseAdmin()
      .from('agent_runs')
      .select('id')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(KEEP_RUNS)
      .returns<Array<{ id: string }>>()
    if (error) throw error
    const keep = new Set((runs ?? []).map((r) => r.id))
    const paths: Array<string> = []
    for (const entry of await listEntries(SCREENSHOT_BUCKET, projectId)) {
      if (entry.id === null && !keep.has(entry.name)) {
        paths.push(...(await listFiles(SCREENSHOT_BUCKET, `${projectId}/${entry.name}`)))
      }
    }
    await removeFiles(SCREENSHOT_BUCKET, paths)
    if (paths.length)
      log.info('Old screenshots pruned', {
        event: 'screenshots.pruned',
        projectId,
        count: paths.length,
      })
    return paths.length
  } catch (error) {
    log.error('Pruning screenshots failed', {
      event: 'screenshots.prune_failed',
      projectId,
      ...errorFields(error),
    })
    return 0
  }
}
