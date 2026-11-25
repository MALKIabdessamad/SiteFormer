import type { ChatMiddleware, ModelMessage } from '@tanstack/ai'
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
        console.warn('[agent] progress save failed', error instanceof Error ? error.message : error)
      }
    },
  }
}
