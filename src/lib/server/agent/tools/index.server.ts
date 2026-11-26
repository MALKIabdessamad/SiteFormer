import type { ProjectMode } from '~/features/projects/lib/constants'
import type { SandboxSession } from '../sandbox-session.server'
import { browserTools } from './browser.server'
import { fileTools } from './files.server'
import { mediaTools } from './media.server'
import { researchTools } from './research.server'
import { shellTools } from './shell.server'

/** Chat mode: tools that only read the project (no edits, commands or generated files). */
const READ_ONLY = new Set([
  'list_files',
  'read_file',
  'search_code',
  'read_dev_logs',
  'check_project',
  'screenshot',
  'inspect_page',
  'audit_page',
  'reference_screenshot',
  'view_image',
  'fetch_url',
  'web_search',
  'package_docs',
])

/**
 * The tools the coding agent can use in a run, bound to its sandbox session: all of them in
 * Build mode, only the read-only ones in Chat mode. Memory tools (remember / forget_memory) are
 * added by the memory adapter.
 */
export function agentTools(session: SandboxSession, mode: ProjectMode) {
  const all = [
    ...shellTools(session),
    ...fileTools(session),
    ...browserTools(session),
    ...mediaTools(session),
    ...researchTools(session),
  ]
  return mode === 'chat' ? all.filter((tool) => READ_ONLY.has(tool.name)) : all
}
