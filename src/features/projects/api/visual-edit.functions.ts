/**
 * The preview's editing tools on the server:
 * - Edit text: the user typed over some text in the preview; it's saved straight into the code
 *   (committed as a checkpoint and noted in the chat, like a Code tab save; no AI, no credits).
 *   When the text comes from code, the result says so and the editor offers the AI instead.
 * - Draw: the user drew on the preview; the page is rendered in the sandbox exactly as they saw
 *   it, with the drawing on top, and stored as a sketch to attach to their next message.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { commitAll, ensureRepo } from '~/lib/server/agent/checkpoints.server'
import { appendAssistantNote, hasActiveRun } from '~/lib/server/agent/runner.server'
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
import { EditError, parseLoc, replaceText } from '~/lib/server/visual-edit/jsx-edit'

export type TextEditResult =
  /** `note`: what the chat now ends with (shown at once, without reloading the chat). */
  | { status: 'saved'; note: string }
  | { status: 'unchanged' }
  | { status: 'unsupported'; message: string }

const allowEdit = rateLimiter(60)
const allowSketch = rateLimiter(20)

const projectId = z.uuid('Project not found.')

const TextInput = validate(
  z.object({
    projectId,
    loc: z
      .string()
      .max(300)
      .refine((value) => parseLoc(value) !== null, 'Invalid element.'),
    before: z.string().min(1).max(2000),
    after: z.string().trim().min(1, 'The text can’t be empty.').max(2000),
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

/** Saves text typed over an element in the preview. */
export const editElementText = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(TextInput)
  .handler(({ data, context }) =>
    safely('editElementText', () =>
      oneAtATime(data.projectId, async (): Promise<TextEditResult> => {
        const at = parseLoc(data.loc)!
        const session = await sessionFor(context.user.id, data.projectId, allowEdit)
        if (await hasActiveRun(data.projectId)) {
          throw new AppError('The agent is working. Try again when it’s done.', 'limit')
        }
        const absolute = editablePath(at.file)
        const file = await readFile(session, absolute)
        if (file.kind === 'missing') throw new AppError('This file no longer exists.', 'not_found')
        if (file.kind !== 'text') throw new AppError('This file can’t be edited here.')
        let next: string
        try {
          next = replaceText(file.content, at, data.before, data.after)
        } catch (error) {
          if (error instanceof EditError) return { status: 'unsupported', message: error.message }
          throw error
        }
        if (next === file.content) return { status: 'unchanged' }
        await writeText(session, absolute, next)
        await ensureRepo(session)
        await commitAll(session, `Text edit: ${at.file}`)
        const note = `✎ You edited text in ${at.file} from the preview. Saved as a checkpoint.`
        await appendAssistantNote(data.projectId, note, { unlessRepeated: true })
        log.info('Text edited in the preview', {
          event: 'preview.text_edited',
          projectId: data.projectId,
          userId: context.user.id,
          path: at.file,
        })
        return { status: 'saved', note }
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
