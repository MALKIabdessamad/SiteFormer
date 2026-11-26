/**
 * Git checkpoints in the project sandbox. Every agent run is bracketed by commits, so each reply
 * can offer "Revert to this version". Restoring never rewrites history: it commits the old tree
 * as a new commit, so a restore can itself be undone.
 */
import { capText, sh, shellQuote, type SandboxSession } from './sandbox-session.server'
import { restartDevServer } from './tools/shell.server'

const SHA = /^[0-9a-f]{7,40}$/
const GITIGNORE = [
  'node_modules',
  'dist',
  '.output',
  '.tanstack',
  '.vinxi',
  '.nitro',
  '*.log',
  '.DS_Store',
]
const IDENTITY = '-c user.name=SiteFormer -c user.email=agent@siteformer.invalid'

/** Makes sure the project is a git repo with a .gitignore (the starter ships without one). */
export async function ensureRepo(session: SandboxSession): Promise<void> {
  const script = [
    `[ -f .gitignore ] || printf '%s\\n' ${GITIGNORE.map(shellQuote).join(' ')} > .gitignore`,
    `[ -d .git ] || git init -q -b main`,
    // Files committed before .gitignore existed stay tracked; untrack heavy folders if so.
    `git rm -r -q --cached --ignore-unmatch node_modules dist .output .tanstack >/dev/null 2>&1 || true`,
  ].join('\n')
  await sh(session, script, { timeoutSeconds: 60 })
}

/** Commits everything (if anything changed) and returns HEAD. */
export async function commitAll(session: SandboxSession, message: string): Promise<string> {
  const subject = message.replace(/\s+/g, ' ').trim().slice(0, 72) || 'Checkpoint'
  const result = await sh(
    session,
    `git add -A && (git diff --cached --quiet || git ${IDENTITY} commit -q --no-verify -m ${shellQuote(subject)}) ` +
      `&& git rev-parse HEAD`,
    { timeoutSeconds: 60 },
  )
  const sha = result.stdout.trim().split('\n').pop() ?? ''
  if (result.exitCode !== 0 || !SHA.test(sha)) {
    throw new Error(`Checkpoint failed: ${capText(result.stderr || result.stdout, 300)}`)
  }
  return sha
}

/** Number of files that differ between two commits. */
export async function filesChanged(
  session: SandboxSession,
  from: string,
  to: string,
): Promise<number> {
  if (!SHA.test(from) || !SHA.test(to) || from === to) return 0
  const result = await sh(session, `git diff --name-only ${from} ${to} | wc -l`, {
    timeoutSeconds: 30,
  })
  return Number(result.stdout.trim()) || 0
}

/**
 * Restores the whole project to `sha` as a NEW commit, reinstalls dependencies if package.json
 * changed, and restarts the preview. Returns the new HEAD.
 */
export async function restoreCheckpoint(session: SandboxSession, sha: string): Promise<string> {
  if (!SHA.test(sha)) throw new Error('Invalid checkpoint')
  const script = [
    `git cat-file -e ${sha}^{commit}`,
    `before=$(git rev-parse HEAD)`,
    `git add -A && (git diff --cached --quiet || git ${IDENTITY} commit -q --no-verify -m "Snapshot before restore")`,
    `git restore --source=${sha} --staged --worktree -- .`,
    `git clean -fdq -e node_modules`,
    `git ${IDENTITY} commit -q --no-verify --allow-empty -m "Restore to ${sha.slice(0, 7)}"`,
    `if ! git diff --quiet $before HEAD -- package.json bun.lock 2>/dev/null; then bun install >/tmp/sf-install.log 2>&1 || tail -20 /tmp/sf-install.log; fi`,
    `git rev-parse HEAD`,
  ].join(' && \\\n')
  const result = await sh(session, script, { timeoutSeconds: 300 })
  const head = result.stdout.trim().split('\n').pop() ?? ''
  if (result.exitCode !== 0 || !SHA.test(head)) {
    throw new Error(`Restore failed: ${capText(result.stderr || result.stdout, 400)}`)
  }
  await restartDevServer(session)
  return head
}
