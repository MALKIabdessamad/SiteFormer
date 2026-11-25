import type { SandboxSession } from '../sandbox-session.server'
import { browserTools } from './browser.server'
import { fileTools } from './files.server'
import { shellTools } from './shell.server'

/**
 * Every tool the coding agent can use, bound to one run's sandbox session. Memory tools
 * (remember / forget_memory) are added by the memory adapter.
 */
export function agentTools(session: SandboxSession) {
  return [...shellTools(session), ...fileTools(session), ...browserTools(session)]
}
