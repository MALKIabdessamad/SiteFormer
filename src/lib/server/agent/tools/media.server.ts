/**
 * generate_image: AI image generation (OpenRouter image model), saved into the project.
 * Paid (~$0.03 per image), so it is budgeted per run and the model must state why it's needed.
 */
import { generateImage, toolDefinition } from '@tanstack/ai'
import { createOpenRouterImage } from '@tanstack/ai-openrouter'
import { z } from 'zod'
import { serverEnv } from '../../env.server'
import { log } from '../../log.server'
import { supabaseAdmin } from '../../supabase-admin.server'
import { relativePath, ToolError, writeBytes, type SandboxSession } from '../sandbox-session.server'
import { SCREENSHOT_BUCKET } from '../screenshots.server'
import { detectType, freePath, safeFileName } from '../uploads.server'
import { optimizeImage } from './browser.server'

const SIZES = {
  '1:1': '1024x1024',
  '16:9': '1344x768',
  '9:16': '768x1344',
  '4:3': '1184x864',
  '3:4': '864x1184',
  '21:9': '1536x672',
} as const

export function mediaTools(session: SandboxSession) {
  const generate = toolDefinition({
    name: 'generate_image',
    description:
      'Generate a photo/illustration with AI and save it in public/images/. Costs real money ' +
      '(~$0.03) and is limited per run. ONLY when the user asks for images/photos, or the page ' +
      'clearly needs a photo (hero, product, blog cover) and the user attached none. NEVER for ' +
      'logos, icons, UI elements, patterns or text (use SVG/CSS), never as filler, never to ' +
      'replace an image the user attached. Write a specific prompt (subject, style, lighting, ' +
      'composition, "no text").',
    inputSchema: z.object({
      purpose: z.string().min(5).max(200).describe('Why this page needs this image.'),
      prompt: z.string().min(20).max(1500),
      fileName: z.string().min(2).max(60).describe('Short name, e.g. "hero-bakery".'),
      aspect: z
        .enum(['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'])
        .optional()
        .describe('Default 16:9.'),
    }),
  }).server(async ({ purpose, prompt, fileName, aspect = '16:9' }) => {
    const env = serverEnv()
    if (session.usage.imagesGenerated >= env.IMAGE_MAX_PER_RUN) {
      return {
        skipped: true,
        reason:
          env.IMAGE_MAX_PER_RUN === 0
            ? 'Image generation is disabled.'
            : `Image budget for this run (${env.IMAGE_MAX_PER_RUN}) is used up. Reuse an existing image or use CSS/SVG.`,
      }
    }
    session.usage.imagesGenerated += 1
    const started = Date.now()
    let result
    try {
      result = await generateImage({
        adapter: createOpenRouterImage(
          env.IMAGE_MODEL as Parameters<typeof createOpenRouterImage>[0],
          env.OPENROUTER_API_KEY,
        ),
        threadId: `image:${session.runId}`,
        prompt,
        numberOfImages: 1,
        size: SIZES[aspect],
      })
    } catch (error) {
      log.warn('Image generation failed', {
        event: 'image.failed',
        runId: session.runId,
        projectId: session.projectId,
        error: error instanceof Error ? error.message : String(error),
      })
      throw new ToolError('Image generation failed. Use CSS/SVG instead or try a simpler prompt.')
    }
    const image = result.images[0] as { b64Json?: string; url?: string } | undefined
    const b64 =
      image?.b64Json ?? (image?.url?.startsWith('data:') ? image.url.split(',')[1] : undefined)
    if (!b64) throw new ToolError('The image model returned no image.')
    let bytes: Buffer = Buffer.from(b64, 'base64')
    let type = detectType(bytes, 'image')
    if (!type || type.kind !== 'image')
      throw new ToolError('The image model returned an unreadable file.')
    // Big PNGs from some models → WebP for the web.
    if (bytes.byteLength > 400 * 1024 && type.mime !== 'image/webp') {
      const smaller = await optimizeImage(session, bytes, type.mime).catch(() => null)
      if (smaller && smaller.byteLength < bytes.byteLength) {
        bytes = smaller
        type = { kind: 'image', mime: 'image/webp', ext: 'webp' }
      }
    }
    const absolute = await freePath(session, 'public/images', safeFileName(fileName, type.ext))
    await writeBytes(session, absolute, bytes)
    // A copy for the chat (same private bucket as screenshots).
    const storagePath = `${session.projectId}/${session.runId}/gen-${Date.now()}.${type.ext}`
    const { error } = await supabaseAdmin()
      .storage.from(SCREENSHOT_BUCKET)
      .upload(storagePath, bytes, { contentType: type.mime, upsert: false })
    const cost = (result.usage as { cost?: number } | undefined)?.cost
    log.info('Image generated', {
      event: 'image.generated',
      runId: session.runId,
      projectId: session.projectId,
      model: env.IMAGE_MODEL,
      costUsd: cost,
      kb: Math.round(bytes.byteLength / 1024),
      ms: Date.now() - started,
      purpose: purpose.slice(0, 120),
    })
    const projectPath = relativePath(absolute)
    return {
      path: projectPath,
      src: `/${projectPath.replace(/^public\//, '')}`,
      kb: Math.round(bytes.byteLength / 1024),
      ...(error ? {} : { image: storagePath }),
      note: 'Saved. Use src in <img>. Use view_image only if you must check it.',
    }
  })

  return [generate]
}
