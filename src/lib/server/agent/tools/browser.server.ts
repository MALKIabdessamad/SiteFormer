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
import { capText, sh, shellQuote, ToolError, type SandboxSession } from '../sandbox-session.server'

import { BROWSER_DIR, BROWSER_ENV, BROWSER_INSTALL_SCRIPT } from '../../sandbox/browser-install'

/** Runner executed with node inside the sandbox. Input: base64 JSON job. Output: one JSON line. */
const RUNNER = String.raw`
const { chromium } = require('playwright-core')
const job = JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8'))
const cap = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s)
;(async () => {
  const out = { ok: true, consoleErrors: [], failedRequests: [], steps: [] }
  const browser = await chromium.launch()
  try {
    const mobile = job.viewport === 'mobile'
    const viewport = mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 }
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 })
    const page = await context.newPage()
    const note = (list, line) => { if (list.length < 15 && !list.includes(line)) list.push(cap(line, 300)) }
    page.on('console', (m) => { if (m.type() === 'error') note(out.consoleErrors, m.text()) })
    page.on('pageerror', (e) => note(out.consoleErrors, 'Uncaught: ' + e.message))
    page.on('requestfailed', (r) => note(out.failedRequests, r.method() + ' ' + r.url() + ' — ' + (r.failure() || {}).errorText))
    page.on('response', (r) => { if (r.status() >= 400) note(out.failedRequests, r.status() + ' ' + r.url()) })
    const res = await page.goto(job.url, { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => { out.navigationError = cap(e.message.split('\n')[0], 300); return null })
    out.status = res ? res.status() : null
    for (const a of job.actions || []) {
      const label = a.type + (a.selector ? ' ' + a.selector : '') + (a.text ? ' "' + cap(a.text, 40) + '"' : '')
      try {
        if (a.type === 'click') await page.locator(a.selector).first().click({ timeout: 8000 })
        else if (a.type === 'fill') await page.locator(a.selector).first().fill(a.text || '', { timeout: 8000 })
        else if (a.type === 'press') await page.keyboard.press(a.key || 'Enter')
        else if (a.type === 'hover') await page.locator(a.selector).first().hover({ timeout: 8000 })
        else if (a.type === 'scroll') await page.mouse.wheel(0, a.pixels || 800)
        else if (a.type === 'wait') await page.waitForTimeout(Math.min(a.ms || 500, 5000))
        else if (a.type === 'goto') await page.goto(new URL(a.path || '/', job.url).href, { waitUntil: 'networkidle', timeout: 30000 })
        out.steps.push('✓ ' + label)
      } catch (e) {
        out.steps.push('✗ ' + label + ': ' + cap(String(e.message).split('\n')[0], 200))
        break
      }
    }
    await page.waitForTimeout(400)
    out.url = page.url()
    out.title = await page.title()
    if (job.outline) {
      out.outline = await page.evaluate(() => {
        const text = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)
        const pick = (sel, n) => Array.from(document.querySelectorAll(sel)).slice(0, n)
        return {
          headings: pick('h1,h2,h3', 25).map((h) => h.tagName.toLowerCase() + ': ' + text(h)),
          links: pick('a[href]', 25).map((a) => text(a) + ' → ' + a.getAttribute('href')),
          buttons: pick('button,[role=button]', 20).map(text),
          inputs: pick('input,textarea,select', 15).map((i) => (i.getAttribute('name') || i.getAttribute('placeholder') || i.type || i.tagName).slice(0, 60)),
          imagesWithoutAlt: pick('img:not([alt])', 10).map((i) => i.getAttribute('src')),
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          text: (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1500),
        }
      })
    }
    if (job.screenshot) {
      const height = job.fullPage
        ? Math.min(await page.evaluate(() => document.documentElement.scrollHeight), 4000)
        : viewport.height
      const shot = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: !!job.fullPage, clip: { x: 0, y: 0, width: viewport.width, height } })
      out.screenshot = shot.toString('base64')
    }
  } finally {
    await browser.close()
  }
  process.stdout.write(JSON.stringify(out))
})().catch((e) => process.stdout.write(JSON.stringify({ ok: false, error: String(e && e.message || e).split('\n')[0] })))
`

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
  viewport: 'desktop' | 'mobile'
  fullPage?: boolean
  screenshot: boolean
  outline: boolean
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

async function runBrowser(session: SandboxSession, job: BrowserJob): Promise<BrowserResult> {
  await ensureBrowser(session)
  const runner = `${BROWSER_DIR}/runner.cjs`
  const runnerB64 = Buffer.from(RUNNER).toString('base64')
  const url = new URL(
    job.path.startsWith('/') ? job.path : `/${job.path}`,
    `http://localhost:${session.previewPort}`,
  )
  const input = Buffer.from(JSON.stringify({ ...job, url: url.href })).toString('base64')
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

/** Screenshots per run (screenshot + interact). Each costs ~4 s plus image tokens. */
export const MAX_SCREENSHOTS_PER_RUN = 4

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
      'step and the user sees it in the chat. Expensive (~4 s + image tokens): take ONE, after ' +
      'you finished a visual change, not after each edit. Desktop by default; mobile only for ' +
      `layout/responsive work. Max ${MAX_SCREENSHOTS_PER_RUN} per run; identical re-shots are ` +
      'refused. Not for text/copy, logic or config changes (use check_project / inspect_page).',
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

  return [screenshot, inspectPage, interact]
}
