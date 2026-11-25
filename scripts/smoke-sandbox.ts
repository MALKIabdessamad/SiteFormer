/**
 * Live smoke test for the sandbox pipeline, using the real server modules (no database):
 *   1. names a project with the OpenRouter naming model
 *   2. creates an Agent37 sandbox, installs the starter and starts its dev server
 *   3. checks the public preview answers, puts the sandbox to sleep and resumes it
 *   4. deletes the sandbox (always, even on failure)
 *
 * Usage: bun run smoke   (needs AGENT37_API_KEY and OPENROUTER_API_KEY in .env)
 * Costs a few seconds of sandbox time.
 */
import { generateProjectName } from '~/lib/server/ai/naming.server'
import { deleteInstance, exec, getInstance } from '~/lib/server/sandbox/agent37.server'
import {
  ensureProvisioned,
  ensureRunning,
  type SandboxPatch,
} from '~/lib/server/sandbox/provision.server'

// The smoke test never touches Supabase; satisfy the env schema without a real key.
process.env.SUPABASE_SECRET_KEY ??= 'smoke-test-not-used-xxxxxxxx'

const prompt = 'A website for my bakery in Lyon with a menu, opening hours and a contact form'
const projectId = crypto.randomUUID()
const state: SandboxPatch = {}
const save = async (patch: SandboxPatch) => {
  Object.assign(state, patch)
  console.log('  save', JSON.stringify(patch))
}
const time = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const start = performance.now()
  const result = await fn()
  console.log(`✓ ${label} (${((performance.now() - start) / 1000).toFixed(1)}s)`)
  return result
}

try {
  const name = await time('naming', () => generateProjectName(prompt))
  console.log('  name:', JSON.stringify(name))

  await time('provision', () =>
    ensureProvisioned({ projectId, userId: 'smoke-test', sandboxId: null, save }),
  )
  if (state.status !== 'ready' || !state.sandbox_id || !state.preview_url) {
    throw new Error(`unexpected state ${JSON.stringify(state)}`)
  }
  const id = state.sandbox_id

  const viaPublicUrl = await exec(
    id,
    `curl -s -o /dev/null -w '%{http_code}' -m 20 ${state.preview_url}`,
  )
  console.log(`✓ public preview ${state.preview_url} → HTTP ${viaPublicUrl.stdout}`)
  if (viaPublicUrl.stdout !== '200') throw new Error('public preview is not serving')

  const starter = await exec(id, 'cd ~/site && git log --oneline && cat package.json | head -3')
  console.log('  starter:', starter.stdout.trim().split('\n').join(' | '))

  // Sleep, then resume like a user reopening the project.
  const sleepRes = await fetch(`https://api.agent37.com/v1/instances/${id}/sleep`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.AGENT37_API_KEY}` },
  })
  console.log('  slept:', sleepRes.status, (await getInstance(id))?.status)
  await time('resume after sleep', () =>
    ensureRunning({ projectId, userId: 'smoke-test', sandboxId: id, save }),
  )

  // Re-running setup on a ready sandbox must be a fast no-op.
  await time('idempotent re-provision', () =>
    ensureProvisioned({ projectId, userId: 'smoke-test', sandboxId: id, save }),
  )
  console.log('\nSMOKE TEST PASSED')
} catch (error) {
  console.error('\nSMOKE TEST FAILED:', error)
  process.exitCode = 1
} finally {
  if (state.sandbox_id) {
    await deleteInstance(state.sandbox_id)
    console.log('✓ deleted sandbox', state.sandbox_id, '→', await getInstance(state.sandbox_id))
  }
}
