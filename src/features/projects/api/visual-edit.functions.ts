/**
 * The visual editor's direct edits: text, style classes and images of an element picked in the
 * preview, and the site's theme colors. Each saves the file, commits a checkpoint and notes it in
 * the chat (one note for a run of edits), like a Code tab save. No AI, no credits.
 *
 * When the code holds no plain value to change (computed in code), the result says so and the
 * editor offers the AI instead.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { commitAll, ensureRepo } from '~/lib/server/agent/checkpoints.server'
import { appendAssistantNote, hasActiveRun } from '~/lib/server/agent/runner.server'
import { writeText, type SandboxSession } from '~/lib/server/agent/sandbox-session.server'
import { optimizeImage } from '~/lib/server/agent/tools/browser.server'
import { copyUploadsIntoProject, resolveUploads } from '~/lib/server/agent/uploads.server'
import { AppError, safely } from '~/lib/server/errors.server'
import { log } from '~/lib/server/log.server'
import { editablePath, readFile, sessionFor } from '~/lib/server/project-files.server'
import { rateLimiter } from '~/lib/server/rate-limit'
import { serialQueue } from '~/lib/server/serial'
import { requireUser } from '~/lib/server/require-user'
import { validate } from '~/lib/server/validate'
import {
  EditError,
  parseLoc,
  replaceClasses,
  replaceImageSrc,
  replaceText,
  type SourceLoc,
} from '~/lib/server/visual-edit/jsx-edit'
import { hexToOklch, HEX } from '../lib/colors'
import { isStyleValue, setStyle, STYLE_GROUPS } from '../lib/tailwind-classes'
import { RADIUS, readRootVars, THEME_COLORS, THEME_FILE, writeRootVars } from '../lib/theme-css'

export type VisualEditResult =
  { status: 'saved' | 'unchanged' } | { status: 'unsupported'; message: string }

// Style tweaks are debounced on the client; this only stops runaway loops.
const allowEdit = rateLimiter(90)

const projectId = z.uuid('Project not found.')
const loc = z
  .string()
  .max(300)
  .refine((value) => parseLoc(value) !== null, 'Invalid element.')

const TextInput = validate(
  z.object({
    projectId,
    loc,
    before: z.string().min(1).max(2000),
    after: z.string().trim().min(1, 'The text can’t be empty.').max(2000),
  }),
)
const StyleInput = validate(
  z
    .object({
      projectId,
      loc,
      group: z.enum(STYLE_GROUPS),
      value: z.string().max(80).nullable(),
    })
    .refine(
      (data) => data.value === null || isStyleValue(data.group, data.value),
      'Invalid style.',
    ),
)
const ImageInput = validate(z.object({ projectId, loc, uploadId: z.uuid('Upload not found.') }))
const ThemeRead = validate(z.object({ projectId }))
const ThemeInput = validate(
  z.object({
    projectId,
    colors: z.partialRecord(
      z.enum(THEME_COLORS.map((color) => color.token)),
      z.string().regex(HEX, 'Invalid color.'),
    ),
    radius: z.string().regex(RADIUS, 'Invalid corner size.').optional(),
  }),
)

// One edit at a time per project, so quick successive edits never overwrite each other.
const oneAtATime = serialQueue()

async function editFile(
  userId: string,
  id: string,
  path: string,
  change: (source: string, session: SandboxSession) => Promise<string> | string,
  note: string,
): Promise<VisualEditResult> {
  return oneAtATime(id, async () => {
    const session = await sessionFor(userId, id, allowEdit)
    if (await hasActiveRun(id)) {
      throw new AppError('The agent is working. Try again when it’s done.', 'limit')
    }
    const absolute = editablePath(path)
    const file = await readFile(session, absolute)
    if (file.kind === 'missing') throw new AppError('This file no longer exists.', 'not_found')
    if (file.kind !== 'text') throw new AppError('This file can’t be edited here.')
    let next: string
    try {
      next = await change(file.content, session)
    } catch (error) {
      if (error instanceof EditError) return { status: 'unsupported', message: error.message }
      throw error
    }
    if (next === file.content) return { status: 'unchanged' }
    await writeText(session, absolute, next)
    await ensureRepo(session)
    await commitAll(session, `Visual edit: ${path}`)
    await appendAssistantNote(id, note, { unlessRepeated: true })
    log.info('Visual edit saved', { event: 'visual.saved', projectId: id, userId, path })
    return { status: 'saved' }
  })
}

const noteFor = (path: string) =>
  `✎ You edited ${path} in the visual editor. Saved as a checkpoint.`
const located = (value: string): SourceLoc => parseLoc(value)!

/** Changes an element's text, typed in place in the preview. */
export const editElementText = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(TextInput)
  .handler(({ data, context }) =>
    safely('editElementText', () => {
      const at = located(data.loc)
      return editFile(
        context.user.id,
        data.projectId,
        at.file,
        (source) => replaceText(source, at, data.before, data.after),
        noteFor(at.file),
      )
    }),
  )

/** Sets one style (color, size, weight, alignment, corners, padding) on an element. */
export const editElementStyle = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(StyleInput)
  .handler(({ data, context }) =>
    safely('editElementStyle', () => {
      const at = located(data.loc)
      return editFile(
        context.user.id,
        data.projectId,
        at.file,
        (source) =>
          replaceClasses(source, at, (classes) => setStyle(classes, data.group, data.value)),
        noteFor(at.file),
      )
    }),
  )

/** Swaps an image for one the user uploaded (copied into public/uploads). */
export const replaceElementImage = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(ImageInput)
  .handler(({ data, context }) =>
    safely('replaceElementImage', async () => {
      const at = located(data.loc)
      const [upload] = await resolveUploads([data.uploadId], data.projectId, context.user.id)
      if (upload?.kind !== 'image') throw new AppError('Choose an image file.')
      return editFile(
        context.user.id,
        data.projectId,
        at.file,
        async (source, session) => {
          replaceImageSrc(source, at, '/') // fails early (before copying) when it can't be swapped
          const [copied] = await copyUploadsIntoProject(session, [upload], (bytes, row) =>
            optimizeImage(session, bytes, row.mime),
          )
          const src = copied?.project_path?.replace(/^public\//, '/')
          if (!src) throw new Error('Copying the image failed')
          return replaceImageSrc(source, at, src)
        },
        noteFor(at.file),
      )
    }),
  )

/** The theme's editable colors and corner size, as written in src/styles.css. */
export const readTheme = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(ThemeRead)
  .handler(({ data, context }) =>
    safely('readTheme', async () => {
      const session = await sessionFor(context.user.id, data.projectId, allowEdit)
      const file = await readFile(session, editablePath(THEME_FILE))
      const vars = file.kind === 'text' ? readRootVars(file.content) : null
      if (!vars) return { colors: {}, radius: null }
      const colors: Record<string, string> = {}
      for (const { token } of THEME_COLORS) if (vars[token]) colors[token] = vars[token]
      return { colors, radius: vars['radius'] ?? null }
    }),
  )

/** Saves theme colors (stored as oklch, like the starter) and the corner size. */
export const saveTheme = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(ThemeInput)
  .handler(({ data, context }) =>
    safely('saveTheme', () => {
      const values: Record<string, string> = {}
      for (const [token, hex] of Object.entries(data.colors)) values[token] = hexToOklch(hex)
      if (data.radius) values['radius'] = data.radius
      return editFile(
        context.user.id,
        data.projectId,
        THEME_FILE,
        (source) => {
          if (!readRootVars(source)) throw new EditError('This site has no theme colors to edit.')
          return writeRootVars(source, values)
        },
        `✎ You changed the theme in ${THEME_FILE}. Saved as a checkpoint.`,
      )
    }),
  )
