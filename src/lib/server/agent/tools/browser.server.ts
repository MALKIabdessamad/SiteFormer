/**
 * Browser tools: a headless Chromium INSIDE the user's sandbox (Playwright), driven by a small
 * runner script. Installed lazily on first use (~15 s, no root needed: missing system libraries
 * are unpacked into a user folder). Screenshots go to Supabase Storage for the chat, and to the
 * model's NEXT call only (vision middleware), so image tokens are paid once.
 */
import { log } from '../../log.server'
import { SCREENSHOT_BUCKET } from '../screenshots.server'
import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'
import { supabaseAdmin } from '../../supabase-admin.server'
import {
  capText,
  readBytes,
  relativePath,
  sh,
  shellQuote,
  sitePath,
  ToolError,
  type SandboxSession,
} from '../sandbox-session.server'
import { isStoredImagePath, isValidStoredImagePath } from '../stored-images'
import { detectType } from '../uploads.server'
import { BROWSER_DIR, BROWSER_ENV, BROWSER_INSTALL_SCRIPT } from '../../sandbox/browser-install'
// Runner executed with node inside the sandbox. Input: base64 JSON job. Output: one JSON line.
import RUNNER from './browser-runner.cjs.txt?raw'

/** Installs the browser if needed. Waits (lock) if the background install is still running. */
async function ensureBrowser(session: SandboxSession): Promise<void> {
  const install = await sh(session, BROWSER_INSTALL_SCRIPT, {
    timeoutSeconds: 300,
    cwd: '/home/node',
  })
  if (install.exitCode !== 0) {
    log.error('Browser install failed in sandbox', {
      event: 'browser.install_failed',
      projectId: session.projectId,
      runId: session.runId,
      stderr: install.stderr.slice(-1500),
    })
    throw new ToolError('The browser could not be installed in the sandbox. Try again later.')
  }
}

type BrowserJob = {
  path: string
  /** Absolute URL (external reference pages). Defaults to `path` on the project's dev server. */
  url?: string
  viewport: 'desktop' | 'mobile'
  fullPage?: boolean
  screenshot: boolean
  outline: boolean
  audit?: boolean
  actions?: Array<Record<string, unknown>>
}

type BrowserResult = {
  ok: boolean
  error?: string
  status?: number | null
  url?: string
  title?: string
  navigationError?: string
  consoleErrors: Array<string>
  failedRequests: Array<string>
  steps: Array<string>
  outline?: Record<string, unknown>
  screenshot?: string
}

/** A page of the user's own site (its dev server in the sandbox), never another host. */
function pageUrl(session: SandboxSession, path: string): string {
  const site = `http://localhost:${session.previewPort}`
  const target = new URL(path.startsWith('/') ? path : `/${path}`, site)
  return target.origin === site ? target.href : `${site}/`
}

async function runBrowser(session: SandboxSession, job: BrowserJob): Promise<BrowserResult> {
  await ensureBrowser(session)
  const runner = `${BROWSER_DIR}/runner.cjs`
  const runnerB64 = Buffer.from(RUNNER).toString('base64')
  const url = job.url ?? pageUrl(session, job.path)
  const input = Buffer.from(JSON.stringify({ ...job, url })).toString('base64')
  // The runner is (re)written every call: tiny, and guarantees the current version.
  const result = await sh(
    session,
    `printf %s ${shellQuote(runnerB64)} | base64 -d > ${runner} && cd ${BROWSER_DIR} && ${BROWSER_ENV} node runner.cjs ${input}`,
    { timeoutSeconds: 120, cwd: '/home/node' },
  )
  try {
    return JSON.parse(result.stdout) as BrowserResult
  } catch {
    throw new ToolError(`Browser failed: ${capText(result.stderr || result.stdout, 400)}`)
  }
}

/** The user's drawing over the preview: strokes in CSS pixels of the visible page. */
export type SketchJob = {
  path: string
  width: number
  height: number
  scrollX: number
  scrollY: number
  strokes: Array<Array<[number, number]>>
}

/** A JPEG of the page as the user saw it, with their drawing on top (for the chat). */
export async function renderSketch(session: SandboxSession, job: SketchJob): Promise<Buffer> {
  await ensureBrowser(session)
  const url = pageUrl(session, job.path)
  const input = Buffer.from(JSON.stringify({ ...job, url, mode: 'sketch' })).toString('base64')
  // Large drawings don't fit on a command line: stage the job in a file.
  const jobFile = `/tmp/sf-sketch-${crypto.randomUUID()}.json`
  for (let i = 0; i < input.length; i += 64_000) {
    await sh(session, `printf %s ${shellQuote(input.slice(i, i + 64_000))} >> ${jobFile}`, {
      timeoutSeconds: 30,
      cwd: '/home/node',
    })
  }
  const runnerB64 = Buffer.from(RUNNER).toString('base64')
  const result = await sh(
    session,
    `printf %s ${shellQuote(runnerB64)} | base64 -d > ${BROWSER_DIR}/runner.cjs && cd ${BROWSER_DIR} && ${BROWSER_ENV} node runner.cjs @${jobFile}; rm -f ${jobFile}`,
    { timeoutSeconds: 90, cwd: '/home/node' },
  )
  let parsed: { ok?: boolean; screenshot?: string; error?: string }
  try {
    parsed = JSON.parse(result.stdout) as typeof parsed
  } catch {
    throw new ToolError(`Browser failed: ${capText(result.stderr || result.stdout, 400)}`)
  }
  if (!parsed.ok || !parsed.screenshot) throw new ToolError(parsed.error ?? 'No screenshot.')
  return Buffer.from(parsed.screenshot, 'base64')
}

/** Stores a screenshot for the chat UI and queues it for the model's next call. */
async function keepScreenshot(session: SandboxSession, base64: string, caption: string) {
  session.screenshotCount += 1
  const path = `${session.projectId}/${session.runId}/${Date.now()}-${session.screenshotCount}.jpg`
  const { error } = await supabaseAdmin()
    .storage.from(SCREENSHOT_BUCKET)
    .upload(path, Buffer.from(base64, 'base64'), { contentType: 'image/jpeg', upsert: false })
  if (error) {
    log.error('Screenshot upload failed', {
      event: 'screenshot.upload_failed',
      projectId: session.projectId,
      runId: session.runId,
      path,
      error: error.message,
    })
  }
  session.pendingImages.push({ mediaType: 'image/jpeg', base64, caption })
  return error ? null : path
}

/** What the model sees from a browser run (never the image bytes: those go via vision). */
function summarize(result: BrowserResult, extra: Record<string, unknown> = {}) {
  if (!result.ok) throw new ToolError(`Browser error: ${result.error ?? 'unknown'}`)
  return {
    url: result.url,
    status: result.status,
    title: result.title,
    ...(result.navigationError ? { navigationError: result.navigationError } : {}),
    consoleErrors: result.consoleErrors,
    failedRequests: result.failedRequests,
    ...(result.steps.length ? { steps: result.steps } : {}),
    ...extra,
  }
}

const pathField = z
  .string()
  .max(500)
  .optional()
  .describe('Path on the preview, e.g. "/" (default) or "/about".')
const viewportField = z
  .enum(['desktop', 'mobile'])
  .optional()
  .describe('desktop (default) = 1280×800, mobile = 390×844.')

/** view_image calls per run (each re-sends an image to the model). */
const MAX_IMAGE_VIEWS_PER_RUN = 4

/** Hosts a reference screenshot must never reach (the sandbox itself, private networks). */
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.internal') ||
    h.endsWith('.local') ||
    /^(127|10|0)\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h === '::1' ||
    /^f[cd][0-9a-f]{2}:/.test(h) ||
    /^fe80:/.test(h)
  )
}

/**
 * Re-encodes a large raster image to WebP (max 2000 px) using the sandbox's browser.
 * Returns null if it can't (the original is used then).
 */
export async function optimizeImage(
  session: SandboxSession,
  bytes: Buffer,
  mime: string,
): Promise<Buffer | null> {
  await ensureBrowser(session)
  const id = crypto.randomUUID()
  const input = `/tmp/sf-opt-${id}`
  const output = `/tmp/sf-opt-${id}.webp`
  const runner = `${BROWSER_DIR}/runner.cjs`
  // Stage the file in the sandbox, then run the runner in optimize mode.
  const b64 = bytes.toString('base64')
  for (let i = 0; i < b64.length; i += 64_000) {
    await sh(
      session,
      `printf %s ${shellQuote(b64.slice(i, i + 64_000))} ${i === 0 ? '>' : '>>'} ${input}.b64`,
      {
        timeoutSeconds: 30,
        cwd: '/home/node',
      },
    )
  }
  const job = Buffer.from(
    JSON.stringify({
      mode: 'optimize',
      file: input,
      out: output,
      mime,
      maxDim: 2000,
      quality: 0.82,
    }),
  ).toString('base64')
  const result = await sh(
    session,
    `base64 -d ${input}.b64 > ${input} && printf %s ${shellQuote(Buffer.from(RUNNER).toString('base64'))} | base64 -d > ${runner} && ` +
      `cd ${BROWSER_DIR} && ${BROWSER_ENV} node runner.cjs ${job} >/dev/null && base64 -w0 ${output}; rm -f ${input} ${input}.b64 ${output}`,
    { timeoutSeconds: 120, cwd: '/home/node' },
  )
  if (result.exitCode !== 0 || !result.stdout.trim()) return null
  return Buffer.from(result.stdout.trim(), 'base64')
}

/** Screenshots per run (screenshot + interact). Each costs ~4 s plus image tokens. */
const MAX_SCREENSHOTS_PER_RUN = 2

/** Why a screenshot should NOT be taken right now (or null when it should). */
function screenshotRefusal(session: SandboxSession, key: string): string | null {
  if (session.screenshotVersions.get(key) === session.workspaceVersion) {
    return 'Not taken: no files changed since your last screenshot of this page and viewport. Reuse what you already saw.'
  }
  if (session.screenshotCount >= MAX_SCREENSHOTS_PER_RUN) {
    return `Not taken: screenshot budget for this run (${MAX_SCREENSHOTS_PER_RUN}) is used up. Use inspect_page for checks, or finish.`
  }
  return null
}

export function browserTools(session: SandboxSession) {
  const screenshot = toolDefinition({
    name: 'screenshot',
    description:
      'Screenshot a page of the running site in a real browser; you SEE the image on your next ' +
      'step and the user sees it in the chat. Expensive (~4 s + image tokens). Usually NOT ' +
      'needed: you can read the code. Use it only for a brand-new page, a large redesign or a ' +
      "layout you can't judge from code, or when the user asks; once, after all edits. " +
      `Desktop by default. Max ${MAX_SCREENSHOTS_PER_RUN} per run; identical re-shots are ` +
      'refused. Never for text, colors, spacing, links or small components.',
    inputSchema: z.object({
      path: pathField,
      viewport: viewportField,
      fullPage: z.boolean().optional().describe('Capture the whole scroll height (max 4000px).'),
    }),
  }).server(async ({ path = '/', viewport = 'desktop', fullPage = false }) => {
    const key = `${path}|${viewport}|${fullPage}`
    const refusal = screenshotRefusal(session, key)
    if (refusal) return { skipped: true, reason: refusal }
    session.screenshotVersions.set(key, session.workspaceVersion)
    const result = await runBrowser(session, {
      path,
      viewport,
      fullPage,
      screenshot: true,
      outline: false,
    })
    const caption = `Screenshot of ${path} (${viewport}${fullPage ? ', full page' : ''})`
    const stored = result.screenshot
      ? await keepScreenshot(session, result.screenshot, caption)
      : null
    return summarize(result, { screenshot: stored, viewport })
  })

  const inspectPage = toolDefinition({
    name: 'inspect_page',
    description:
      'Load a page in a real browser WITHOUT a screenshot (cheap): status, title, console errors, ' +
      'failed requests, headings, links, buttons, inputs, images missing alt text, horizontal ' +
      'overflow, and the visible text. Use to debug or check structure/content.',
    inputSchema: z.object({ path: pathField, viewport: viewportField }),
  }).server(async ({ path = '/', viewport = 'desktop' }) => {
    const result = await runBrowser(session, { path, viewport, screenshot: false, outline: true })
    return summarize(result, { outline: result.outline })
  })

  const interact = toolDefinition({
    name: 'interact',
    description:
      'Drive the page like a user: click, fill inputs, press keys, hover, scroll, wait, or ' +
      'navigate. Stops at the first failing step and reports each step. Use only to test real ' +
      'behaviour (menus, forms, modals, tabs, navigation). Set screenshot:true only when you ' +
      'need to see the result (counts toward the screenshot budget).',
    inputSchema: z.object({
      path: pathField,
      viewport: viewportField,
      actions: z
        .array(
          z.object({
            type: z.enum(['click', 'fill', 'press', 'hover', 'scroll', 'wait', 'goto']),
            selector: z
              .string()
              .max(300)
              .optional()
              .describe(
                'Playwright selector, e.g. "text=Contact", "button:has-text(\'Send\')", "#email".',
              ),
            text: z.string().max(2000).optional().describe('For fill.'),
            key: z.string().max(40).optional().describe('For press, e.g. "Enter".'),
            pixels: z.number().int().min(-10000).max(10000).optional().describe('For scroll.'),
            ms: z.number().int().min(0).max(5000).optional().describe('For wait.'),
            path: z.string().max(300).optional().describe('For goto.'),
          }),
        )
        .min(1)
        .max(20),
      screenshot: z.boolean().optional().describe('Screenshot after the actions (default false).'),
    }),
  }).server(
    async ({ path = '/', viewport = 'desktop', actions, screenshot: requested = false }) => {
      const shotKey = `interact|${path}|${viewport}|${JSON.stringify(actions)}`
      const refusal = requested ? screenshotRefusal(session, shotKey) : null
      const wantShot = requested && !refusal
      if (wantShot) session.screenshotVersions.set(shotKey, session.workspaceVersion)
      const result = await runBrowser(session, {
        path,
        viewport,
        actions,
        screenshot: wantShot,
        outline: false,
      })
      const stored =
        wantShot && result.screenshot
          ? await keepScreenshot(
              session,
              result.screenshot,
              `After interacting with ${path} (${viewport})`,
            )
          : null
      return summarize(result, {
        screenshot: stored,
        viewport,
        ...(refusal ? { screenshotSkipped: refusal } : {}),
      })
    },
  )

  const auditPage = toolDefinition({
    name: 'audit_page',
    description:
      'Audit a page in a real browser (no screenshot, cheap): accessibility violations (axe-core, ' +
      'WCAG A/AA), SEO basics (title, meta description, h1, lang, alt text, Open Graph) and ' +
      'performance hints (LCP, CLS, heavy resources, oversized images). Use when the user asks ' +
      'for an audit/SEO/accessibility/performance check, or once before you call a new site done.',
    inputSchema: z.object({ path: pathField, viewport: viewportField }),
  }).server(async ({ path = '/', viewport = 'desktop' }) => {
    const result = await runBrowser(session, {
      path,
      viewport,
      screenshot: false,
      outline: false,
      audit: true,
    })
    const r = result as BrowserResult & Record<string, unknown>
    return summarize(result, {
      accessibility: r.accessibility,
      seo: r.seo,
      performance: r.performance,
    })
  })

  const referenceScreenshot = toolDefinition({
    name: 'reference_screenshot',
    description:
      'Screenshot an EXTERNAL website the user named as a reference/inspiration (e.g. "make it ' +
      'feel like stripe.com"); you see it on your next step. Only when the user points to a ' +
      'site. Counts toward the screenshot budget.',
    inputSchema: z.object({
      url: z.url().max(500),
      viewport: viewportField,
      fullPage: z.boolean().optional().describe('Whole page (max 4000px). Default false.'),
    }),
  }).server(async ({ url, viewport = 'desktop', fullPage = false }) => {
    const target = new URL(url)
    if (!/^https?:$/.test(target.protocol) || isPrivateHost(target.hostname)) {
      throw new ToolError('Only public http(s) websites can be used as references.')
    }
    const key = `ref|${target.href}|${viewport}|${fullPage}`
    const refusal = screenshotRefusal(session, key)
    if (refusal) return { skipped: true, reason: refusal }
    session.screenshotVersions.set(key, session.workspaceVersion)
    const result = await runBrowser(session, {
      path: '/',
      url: target.href,
      viewport,
      fullPage,
      screenshot: true,
      outline: false,
    })
    const stored = result.screenshot
      ? await keepScreenshot(session, result.screenshot, `Reference: ${target.host} (${viewport})`)
      : null
    return {
      url: result.url,
      title: result.title,
      status: result.status,
      ...(result.navigationError ? { navigationError: result.navigationError } : {}),
      screenshot: stored,
      viewport,
    }
  })

  const viewImage = toolDefinition({
    name: 'view_image',
    description:
      'Look at an image on your next step: a file in the project (an earlier upload in ' +
      'public/uploads/…, a generated image) or an earlier screenshot (the "screenshot" path a ' +
      'tool returned). Only when you must SEE it for the task (not for text/CSS edits). Each ' +
      `image once per run; max ${MAX_IMAGE_VIEWS_PER_RUN} per run. SVG files are returned as source code.`,
    inputSchema: z.object({ path: z.string().min(1).max(300) }),
  }).server(async ({ path }) => {
    if (session.usage.imageViews >= MAX_IMAGE_VIEWS_PER_RUN) {
      return {
        skipped: true,
        reason: `Image view budget for this run (${MAX_IMAGE_VIEWS_PER_RUN}) is used up.`,
      }
    }
    const stored = isStoredImagePath(session.projectId, path)
    if (stored && !isValidStoredImagePath(session.projectId, path)) {
      throw new ToolError('Screenshot not found.')
    }
    // Stored screenshots never change; project files can, so key them by workspace version.
    const key = stored ? `view|${path}` : `view|${path}|${session.workspaceVersion}`
    if (session.screenshotVersions.has(key)) {
      return {
        skipped: true,
        reason: 'You already looked at this image in this run. Rely on what you saw.',
      }
    }
    let bytes: Buffer
    let label: string
    if (stored) {
      // An earlier screenshot or generated image in Storage (only this project's).
      const { data, error } = await supabaseAdmin().storage.from(SCREENSHOT_BUCKET).download(path)
      if (error || !data) throw new ToolError('Screenshot not found.')
      bytes = Buffer.from(await data.arrayBuffer())
      label = 'earlier screenshot'
    } else {
      const absolute = sitePath(path)
      bytes = await readBytes(session, absolute, 6_000_000)
      label = relativePath(absolute)
    }
    const type = detectType(bytes, path)
    if (type?.mime === 'image/svg+xml') {
      return { path: label, svg: capText(bytes.toString('utf8'), 4000) }
    }
    if (!type || type.kind !== 'image') throw new ToolError('That file is not an image.')
    session.usage.imageViews += 1
    session.screenshotVersions.set(key, session.workspaceVersion)
    session.pendingImages.push({
      mediaType: type.mime,
      base64: bytes.toString('base64'),
      caption: `Image: ${label}`,
    })
    return { path: label, queued: true, note: 'You will see the image on your next step.' }
  })

  return [screenshot, inspectPage, interact, auditPage, referenceScreenshot, viewImage]
}
