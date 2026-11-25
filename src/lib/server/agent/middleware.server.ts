import type { ChatMiddleware, ModelMessage } from '@tanstack/ai'
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
