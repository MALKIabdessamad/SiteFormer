import type { ChatMiddleware, ContentPart, ModelMessage } from '@tanstack/ai'
import { billableTokens, type Usage } from '~/features/billing/lib/credits'
import { chargeTokens } from '../billing/credits.server'
import { errorFields, log } from '../log.server'
import { persistence } from './persistence.server'
import type { SandboxSession } from './sandbox-session.server'

/**
 * Shows the model the screenshots its tools just took, on its NEXT call only. They go into the
 * provider-only context, never into the saved transcript, so each image is paid for once and the
 * transcript stays small.
 */
export function visionMiddleware(session: SandboxSession): ChatMiddleware {
  return {
    name: 'siteformer-vision',
    onConfig(ctx, config) {
      if (ctx.phase !== 'beforeModel' || session.pendingImages.length === 0) return undefined
      const images = session.pendingImages.splice(0)
      const message: ModelMessage = {
        role: 'user',
        content: [
          {
            type: 'text',
            content: `${images.map((i) => i.caption).join('; ')}. Check them against what you intended.`,
          },
          ...images.map((image) => ({
            type: 'image' as const,
            source: { type: 'data' as const, value: image.base64, mimeType: image.mediaType },
          })),
        ],
      }
      return { providerMessages: [...(config.providerMessages ?? config.messages), message] }
    },
  }
}

/**
 * Saves the transcript after every tool round (withPersistence saves at start and finish only),
 * so a server restart mid-run loses at most the step in progress.
 */
export function progressSaverMiddleware(threadId: string): ChatMiddleware {
  return {
    name: 'siteformer-progress',
    async onToolPhaseComplete(ctx) {
      try {
        await persistence.stores.messages.saveThread(threadId, [...ctx.messages])
      } catch (error) {
        log.warn('Agent progress save failed', {
          event: 'agent.progress_save_failed',
          projectId: threadId,
          ...errorFields(error),
        })
      }
    },
  }
}

type RunLogger = ReturnType<typeof log.with>

/** Short, log-safe summary of a tool's input (paths/commands, never file contents). */
function toolInputSummary(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object') return {}
  const pick: Record<string, unknown> = {}
  for (const key of ['path', 'from', 'to', 'query', 'command', 'url', 'viewport', 'kind']) {
    const value = (input as Record<string, unknown>)[key]
    if (typeof value === 'string') pick[key] = value.slice(0, 160)
  }
  return pick
}

/**
 * Structured logs for every model step and tool call of a run (Railway: filter `@runId:<id>`,
 * `@event:agent.tool`, `@ok:false`).
 */
export function loggingMiddleware(runLog: RunLogger): ChatMiddleware {
  let steps = 0
  let tools = 0
  return {
    name: 'siteformer-logging',
    onIteration() {
      steps += 1
      runLog.debug('Agent step', { event: 'agent.step', step: steps })
    },
    onAfterToolCall(_ctx, info) {
      tools += 1
      const result = info.result as Record<string, unknown> | undefined
      const toolError =
        info.error ?? (result && typeof result.error === 'string' ? result.error : undefined)
      const fields = {
        event: 'agent.tool',
        tool: info.toolName,
        ms: Math.round(info.duration),
        ok: info.ok && !toolError,
        ...toolInputSummary(
          info.toolCall.function?.arguments
            ? safeParse(info.toolCall.function.arguments)
            : undefined,
        ),
        ...(toolError
          ? {
              toolError: String(toolError instanceof Error ? toolError.message : toolError).slice(
                0,
                500,
              ),
            }
          : {}),
      }
      if (fields.ok) runLog.info(`Tool ${info.toolName}`, fields)
      else runLog.warn(`Tool ${info.toolName} failed`, fields)
    },
    onFinish(_ctx, info) {
      runLog.info('Agent model loop finished', {
        event: 'agent.loop_finished',
        steps,
        tools,
        ms: Math.round(info.duration),
        finishReason: info.finishReason,
        promptTokens: info.usage?.promptTokens,
        completionTokens: info.usage?.completionTokens,
      })
    },
    onAbort(_ctx, info) {
      runLog.info('Agent model loop aborted', {
        event: 'agent.loop_aborted',
        steps,
        tools,
        reason: info.reason,
      })
    },
    onError(_ctx, info) {
      runLog.error('Agent model loop error', {
        event: 'agent.loop_error',
        steps,
        tools,
        ...errorFields(info.error),
      })
    },
  }
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return undefined
  }
}

const UPLOAD_SCHEME = 'sf-upload:'

/** "sf-upload:<id>" of an image/document part, or null. */
function uploadId(part: ContentPart): string | null {
  if (part.type !== 'image' && part.type !== 'document') return null
  const source = (part as { source?: { type?: string; value?: string } }).source
  return source?.type === 'url' && source.value?.startsWith(UPLOAD_SCHEME)
    ? source.value.slice(UPLOAD_SCHEME.length)
    : null
}

/** Replaces attachment references with text the model can use (never sends "sf-upload:" URLs). */
export function stripAttachments(
  messages: Array<ModelMessage>,
  describe: (id: string) => string,
): Array<ModelMessage> {
  return messages.map((message) => {
    if (!Array.isArray(message.content)) return message
    if (!message.content.some((part) => uploadId(part))) return message
    return {
      ...message,
      content: message.content.map((part) => {
        const id = uploadId(part)
        return id ? ({ type: 'text', content: describe(id) } as ContentPart) : part
      }),
    }
  })
}

/**
 * Attached files in the model's context: images attached to THIS run's message are sent as real
 * images on every model call of the run (same bytes each call, so the provider's prompt cache
 * keeps them cheap and the model never has to re-open them). Attachments of earlier messages
 * become a one-line note with the file's path in the project (view_image to look again).
 */
export function attachmentsMiddleware(session: SandboxSession): ChatMiddleware {
  const describe = (id: string) => {
    const upload = session.uploads.get(id)
    if (!upload) return '[Attachment no longer available]'
    const where = upload.project_path ? ` → ${upload.project_path}` : ''
    const shown = session.attachedImages.has(id)
    return upload.kind === 'image'
      ? `[Attached image "${upload.name}"${where}${upload.project_path ? ` (use as /${upload.project_path.replace(/^public\//, '')}${shown ? '; shown below' : '; view_image to look at it'})` : ''}]`
      : `[Attached file "${upload.name}"${where}${upload.project_path ? ' (read it with read_file)' : ''}]`
  }
  return {
    name: 'siteformer-attachments',
    onConfig(ctx, config) {
      if (ctx.phase !== 'beforeModel') return undefined
      const base = config.providerMessages ?? config.messages
      const messages = base.map((message) => {
        if (!Array.isArray(message.content) || !message.content.some((p) => uploadId(p)))
          return message
        return {
          ...message,
          content: message.content.flatMap((part): Array<ContentPart> => {
            const id = uploadId(part)
            if (!id) return [part]
            const image = session.attachedImages.get(id)
            if (!image) return [{ type: 'text', content: describe(id) } as ContentPart]
            return [
              { type: 'text', content: describe(id) } as ContentPart,
              {
                type: 'image',
                source: { type: 'data', value: image.base64, mimeType: image.mime },
              } as ContentPart,
            ]
          }),
        }
      })
      return { providerMessages: messages }
    },
  }
}

/**
 * Charges credits after every model step (in the database, so a crash or deploy never skips
 * usage) and calls `onExhausted` once the balance reaches zero; the runner then stops the run.
 * Charges are serialized so the balance seen is always the latest.
 */
export function creditsMiddleware(
  session: SandboxSession,
  onExhausted: () => void,
): ChatMiddleware {
  let queue: Promise<unknown> = Promise.resolve()
  let exhausted = false
  return {
    name: 'siteformer-credits',
    onUsage(_ctx, usage) {
      const tokens = billableTokens(usage as Usage)
      if (tokens <= 0) return
      queue = queue.then(async () => {
        try {
          const balance = await chargeTokens(session.runId, tokens)
          if (balance <= 0 && !exhausted) {
            exhausted = true
            onExhausted()
          }
        } catch (error) {
          // Never break a run over metering; the failure is logged for follow-up.
          log.error('Charging credits failed', {
            event: 'billing.charge_failed',
            runId: session.runId,
            tokens,
            ...errorFields(error),
          })
        }
      })
      return queue as Promise<void>
    },
  }
}
