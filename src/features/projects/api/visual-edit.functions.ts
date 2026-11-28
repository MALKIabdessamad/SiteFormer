/**
 * The preview's editing tools on the server:
 * - Edit text: the user changed texts in the preview, then pressed Save: they're written straight
 *   into the code (one checkpoint, noted in the chat; no AI, so no credits, on any plan). A text
 *   that comes from code can't be saved this way: the result says so and the editor offers the
 *   AI instead.
 * - Draw: the user drew on the preview; the page is rendered in the sandbox exactly as they saw
 *   it, with the drawing on top, and stored as a sketch to attach to their next message.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { commitAll, ensureRepo } from '~/lib/server/agent/checkpoints.server'
import { hasActiveRun } from '~/lib/server/agent/runner.server'
import { appendAssistantNote } from '~/lib/server/agent/transcript.server'
import { writeText } from '~/lib/server/agent/sandbox-session.server'
import { renderSketch } from '~/lib/server/agent/tools/browser.server'
import { saveUpload } from '~/lib/server/agent/uploads.server'
import { AppError, safely } from '~/lib/server/errors.server'
import { log } from '~/lib/server/log.server'
import { editablePath, readFile, sessionFor } from '~/lib/server/project-files.server'
import { rateLimiter } from '~/lib/server/rate-limit'
import { requireUser } from '~/lib/server/require-user'
import { serialQueue } from '~/lib/server/serial'
import { validate } from '~/lib/server/validate'
import { applyTextEdits, parseLoc, type TextEdit } from '~/lib/server/visual-edit/jsx-edit'

export type TextSaveResult = {
  /** What the chat now ends with, when something was saved. */
  note: string | null
  /** Changes that couldn't be saved directly (e.g. the text comes from code). */
  failed: Array<{ loc: string; after: string; message: string }>
}

const allowEdit = rateLimiter(60)
const allowSketch = rateLimiter(20)

const projectId = z.uuid('Project not found.')

const TextEditsInput = validate(
  z.object({
    projectId,
    edits: z
      .array(
        z.object({
          loc: z
            .string()
            .max(300)
            .refine((value) => parseLoc(value) !== null, 'Invalid element.'),
          before: z.string().min(1).max(2000),
          after: z.string().trim().min(1, 'A text can’t be empty.').max(2000),
        }),
      )
      .min(1)
      .max(50),
  }),
)

/** Most points a drawing may have (it's resent in full; plenty for marks and arrows). */
const MAX_POINTS = 6000
const SketchInput = validate(
  z
    .object({
      projectId,
      path: z.string().startsWith('/').max(2000),
      width: z.number().int().min(200).max(3000),
      height: z.number().int().min(200).max(3000),
      scrollX: z.number().int().min(0).max(1_000_000),
      scrollY: z.number().int().min(0).max(1_000_000),
      strokes: z
        .array(z.array(z.tuple([z.number().int(), z.number().int()])).min(1))
        .min(1, 'Draw something first.')
        .max(100),
    })
    .refine(
      (data) => data.strokes.reduce((n, stroke) => n + stroke.length, 0) <= MAX_POINTS,
      'That drawing is too detailed. Clear it and draw a little less.',
    ),
)

// One edit at a time per project, so quick successive edits never overwrite each other.
const oneAtATime = serialQueue()

/** Saves the texts changed in the preview (all of them in one checkpoint). */
export const saveTextEdits = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(TextEditsInput)
  .handler(({ data, context }) =>
    safely('saveTextEdits', () =>
      oneAtATime(data.projectId, async (): Promise<TextSaveResult> => {
        const session = await sessionFor(context.user.id, data.projectId, allowEdit)
        if (await hasActiveRun(data.projectId)) {
          throw new AppError('The agent is working. Save when it’s done.', 'limit')
        }
        const byFile = new Map<string, Array<TextEdit & { raw: string }>>()
        for (const edit of data.edits) {
          const loc = parseLoc(edit.loc)!
          const list = byFile.get(loc.file) ?? []
          list.push({ loc, raw: edit.loc, before: edit.before, after: edit.after })
          byFile.set(loc.file, list)
        }
        const failed: TextSaveResult['failed'] = []
        const changed: Array<string> = []
        for (const [path, edits] of byFile) {
          const absolute = editablePath(path)
          const file = await readFile(session, absolute)
          if (file.kind !== 'text') {
            const message =
              file.kind === 'missing'
                ? 'This file no longer exists.'
                : 'This file can’t be edited here.'
            for (const edit of edits) failed.push({ loc: edit.raw, after: edit.after, message })
            continue
          }
          const result = applyTextEdits(file.content, edits)
          for (const { edit, message } of result.failed) {
            failed.push({ loc: edit.raw, after: edit.after, message })
          }
          if (result.code !== file.content) {
            await writeText(session, absolute, result.code)
            changed.push(path)
          }
        }
        if (changed.length === 0) return { note: null, failed }

        await ensureRepo(session)
        await commitAll(session, `Text edits: ${changed.join(', ')}`)
        const saved = data.edits.length - failed.length
        const what = saved === 1 ? 'text' : `${saved} texts`
        const note = `✎ You edited ${what} in ${changed.join(', ')} from the preview. Saved as a checkpoint.`
        await appendAssistantNote(data.projectId, note, { unlessRepeated: true })
        log.info('Texts edited in the preview', {
          event: 'preview.text_edited',
          projectId: data.projectId,
          userId: context.user.id,
          files: changed,
          saved,
          failed: failed.length,
        })
        return { note, failed }
      }),
    ),
  )

/** The preview with the user's drawing on it, stored to attach to their next message. */
export const captureSketch = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(SketchInput)
  .handler(({ data, context }) =>
    safely('captureSketch', async () => {
      const session = await sessionFor(context.user.id, data.projectId, allowSketch)
      const image = await renderSketch(session, data)
      const row = await saveUpload({
        userId: context.user.id,
        projectId: data.projectId,
        name: `Drawing on ${data.path.split(/[?#]/)[0]}.jpg`,
        bytes: new Uint8Array(image),
        purpose: 'sketch',
      })
      log.info('Drawing captured', {
        event: 'preview.sketch',
        projectId: data.projectId,
        userId: context.user.id,
        strokes: data.strokes.length,
        bytes: image.byteLength,
      })
      return {
        upload: {
          id: row.id,
          name: row.name,
          kind: row.kind,
          mime: row.mime,
          size: row.size,
          storagePath: row.storage_path,
        },
        /** For the composer's thumbnail (the same JPEG). */
        image: image.toString('base64'),
      }
    }),
  )
