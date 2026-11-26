/**
 * Screenshot files (and copies of generated images) live in the private bucket at
 * "<project_id>/<run_id>/<file>". Storage objects are not removed by database cascades, so
 * deleting a project removes them here; only the newest KEEP_RUNS runs keep theirs.
 */
import { log } from '../log.server'
import { supabaseAdmin } from '../supabase-admin.server'

export const SCREENSHOT_BUCKET = 'agent-screenshots'
const PAGE = 1000
/** Runs per project whose screenshots are kept (older ones show as "cleared" in the chat). */
export const KEEP_RUNS = 20

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
    for (const entry of await listAll(projectId)) {
      if (entry.id !== null || keep.has(entry.name)) continue
      for (const file of await listAll(`${projectId}/${entry.name}`)) {
        if (file.id !== null) paths.push(`${projectId}/${entry.name}/${file.name}`)
      }
    }
    for (let i = 0; i < paths.length; i += 100) {
      const { error: removeError } = await supabaseAdmin()
        .storage.from(SCREENSHOT_BUCKET)
        .remove(paths.slice(i, i + 100))
      if (removeError) throw removeError
    }
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
      error: error instanceof Error ? error.message : String(error),
    })
    return 0
  }
}

/** Top-level folders (= project ids) in the screenshot bucket. */
export async function screenshotProjectFolders(): Promise<Array<string>> {
  return (await listAll('')).filter((e) => e.id === null).map((e) => e.name)
}
