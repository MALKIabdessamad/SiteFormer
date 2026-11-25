/**
 * Shell, dev-server, verification, web and planning tools.
 */
import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'
import { capText, sh, shellQuote, ToolError, type SandboxSession } from '../sandbox-session.server'

const OUTPUT_MAX = 8000

/** Starts the dev server unless it runs, then waits until it answers (any non-5xx). */
export async function restartDevServer(session: SandboxSession, { force = true } = {}) {
  const port = session.previewPort
  const script = [
    force ? `pkill -f "[v]ite dev" || true; sleep 1` : ':',
    `pgrep -f "[v]ite dev" >/dev/null || (nohup bun run dev >/tmp/dev.log 2>&1 &)`,
    `for i in $(seq 1 60); do c=$(curl -s -o /dev/null -m 5 -w '%{http_code}' http://localhost:${port}/ || true); ` +
      `if [ "$c" -ge 200 ] 2>/dev/null && [ "$c" -lt 500 ]; then echo "ready $c"; exit 0; fi; sleep 1; done`,
    `echo not-ready; tail -40 /tmp/dev.log`,
  ].join('\n')
  const result = await sh(session, script, { timeoutSeconds: 90 })
  const ready = result.stdout.startsWith('ready')
  return { ready, ...(ready ? {} : { log: capText(result.stdout, 3000) }) }
}

/** Minimal HTML → readable text (pages fetched with fetch_url). */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|iframe|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(
      /<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/header|\/footer)[^>]*>/gi,
      '\n',
    )
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<h([1-6])[^>]*>/gi, (_m, level: string) => `\n${'#'.repeat(Number(level))} `)
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
}

export function shellTools(session: SandboxSession) {
  const updatePlan = toolDefinition({
    name: 'update_plan',
    description:
      'Show the user your plan as a checklist and keep it current (mark steps in_progress/done ' +
      'as you go). Use for any task with 3+ steps. Keep step titles short.',
    inputSchema: z.object({
      steps: z
        .array(
          z.object({
            title: z.string().min(1).max(120),
            status: z.enum(['pending', 'in_progress', 'done']),
          }),
        )
        .min(1)
        .max(15),
    }),
  }).server(async ({ steps }) => ({
    ok: true,
    remaining: steps.filter((s) => s.status !== 'done').length,
  }))

  const runCommand = toolDefinition({
    name: 'run_command',
    description:
      'Run a shell command in the project folder (bash; Bun is on PATH). For installs (`bun add x`), ' +
      'scripts, git inspection, tests, file utilities. Never start the dev server or any other ' +
      'long-running process here: use restart_dev_server. Output is truncated to the most useful part.',
    inputSchema: z.object({
      command: z.string().min(1).max(4000),
      timeoutSeconds: z.number().int().min(5).max(600).optional().describe('Default 120.'),
    }),
  }).server(async ({ command, timeoutSeconds = 120 }) => {
    // Starting a server here would just hang until the timeout; the preview has its own tool.
    const startsServer =
      /(^|[;&|(]\s*)(bun|npm|pnpm|yarn)\s+(run\s+)?(dev|start|preview)\b/.test(command) ||
      /\bvite(\s+(dev|serve|preview))?\s*($|[;&|)])/.test(command)
    if (startsServer) {
      throw new ToolError(
        'Do not start servers with run_command; the preview uses restart_dev_server.',
      )
    }
    const result = await sh(session, command, { timeoutSeconds })
    session.workspaceVersion += 1 // a command may have changed files (installs, codegen…)
    return {
      exitCode: result.exitCode,
      stdout: capText(result.stdout, OUTPUT_MAX),
      stderr: capText(result.stderr, OUTPUT_MAX / 2),
    }
  })

  const restart = toolDefinition({
    name: 'restart_dev_server',
    description:
      'Restart the preview dev server (after changing vite.config, installing packages, or when it ' +
      'is stuck) and wait until it answers. Returns the log if it fails to start.',
    inputSchema: z.object({}),
  }).server(async () => restartDevServer(session))

  const devLogs = toolDefinition({
    name: 'read_dev_logs',
    description: 'Show the last lines of the dev server log (build errors, SSR errors, warnings).',
    inputSchema: z.object({ lines: z.number().int().min(10).max(300).optional() }),
  }).server(async ({ lines = 80 }) => {
    const result = await sh(
      session,
      `tail -${lines} /tmp/dev.log 2>/dev/null || echo "(no log yet)"`,
      {
        timeoutSeconds: 15,
      },
    )
    return { log: capText(result.stdout, OUTPUT_MAX) }
  })

  const checkProject = toolDefinition({
    name: 'check_project',
    description:
      'Verify the project: TypeScript type check, whether the preview answers, and recent dev ' +
      'server errors. Run after edits and before you finish. Optionally run ESLint too.',
    inputSchema: z.object({ lint: z.boolean().optional() }),
  }).server(async ({ lint = false }) => {
    // Nothing changed since the last check: don't spend ~10 s re-running it.
    if (!lint && session.lastCheck?.version === session.workspaceVersion) {
      return {
        ...session.lastCheck.result,
        note: 'No files changed since the last check; same result.',
      }
    }
    const port = session.previewPort
    const script = [
      `echo "== typecheck"; bunx --bun tsc --noEmit -p . 2>&1 | head -60; echo "exit=\${PIPESTATUS[0]}"`,
      lint
        ? `echo "== lint"; bunx eslint . --max-warnings=0 2>&1 | tail -40; echo "exit=\${PIPESTATUS[0]}"`
        : ':',
      `echo "== preview"; curl -s -o /dev/null -m 15 -w '%{http_code}' http://localhost:${port}/ || echo 000`,
      `echo; echo "== devlog"; tail -200 /tmp/dev.log 2>/dev/null | grep -iE "error|failed|cannot|unexpected" | tail -15`,
    ].join('\n')
    const result = await sh(session, script, { timeoutSeconds: 240 })
    const section = (name: string) =>
      (result.stdout.split(`== ${name}\n`)[1] ?? '').split('\n== ')[0]!.trim()
    const typecheck = section('typecheck')
    const typeOk = /exit=0\s*$/.test(typecheck)
    const lintOut = lint ? section('lint') : ''
    const preview = section('preview').split('\n')[0] ?? '000'
    const devErrors = section('devlog')
    const outcome = {
      typecheck: typeOk ? 'passed' : 'failed',
      ...(typeOk ? {} : { typeErrors: capText(typecheck.replace(/exit=\d+\s*$/, ''), 5000) }),
      ...(lint
        ? {
            lint: /exit=0\s*$/.test(lintOut) ? 'passed' : 'failed',
            ...(/exit=0\s*$/.test(lintOut) ? {} : { lintErrors: capText(lintOut, 3000) }),
          }
        : {}),
      preview:
        Number(preview) >= 200 && Number(preview) < 500
          ? `ok (${preview})`
          : `not answering (${preview})`,
      ...(devErrors ? { recentDevErrors: capText(devErrors, 2000) } : {}),
    }
    if (!lint) session.lastCheck = { version: session.workspaceVersion, result: outcome }
    return outcome
  })

  const fetchUrl = toolDefinition({
    name: 'fetch_url',
    description:
      'Fetch a public web page or API (docs, examples, JSON) and return it as readable text, ' +
      'truncated. Fetched from the sandbox.',
    inputSchema: z.object({
      url: z.url().max(2000),
      maxChars: z.number().int().min(1000).max(30_000).optional().describe('Default 12000.'),
    }),
  }).server(async ({ url, maxChars = 12_000 }) => {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new ToolError('Only http(s) URLs can be fetched.')
    }
    const result = await sh(
      session,
      `curl -sSL --max-time 25 --max-filesize 3000000 -A "Mozilla/5.0 (SiteFormer agent)" ` +
        `-o /tmp/sf-fetch -w '%{http_code} %{content_type}' ${shellQuote(parsed.href)}; ` +
        `echo; head -c 2000000 /tmp/sf-fetch | base64 -w0; rm -f /tmp/sf-fetch`,
      { timeoutSeconds: 40, cwd: '/tmp' },
    )
    const [meta = '', body = ''] = result.stdout.split('\n')
    const [status = '000', ...typeParts] = meta.trim().split(' ')
    const contentType = typeParts.join(' ')
    if (status === '000')
      throw new ToolError(`Could not fetch ${parsed.href}: ${capText(result.stderr, 300)}`)
    const raw = Buffer.from(body, 'base64').toString('utf8')
    const text = /html/i.test(contentType) ? htmlToText(raw) : raw
    return { status: Number(status), contentType, content: capText(text, maxChars) }
  })

  return [updatePlan, runCommand, restart, devLogs, checkProject, fetchUrl]
}
