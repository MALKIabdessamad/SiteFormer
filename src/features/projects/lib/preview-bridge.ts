/**
 * Messages between the editor and the bridge inside the preview (see
 * src/lib/server/sandbox/editor/bridge.js.txt). Everything arrives from the user's own site, so
 * it is checked before use, and the server validates again.
 */
import type { ElementRef } from '~/features/agent'

export type PageError = { kind: 'runtime' | 'build'; message: string; stack: string; path: string }

export type BridgeEvent =
  | { type: 'here' }
  | { type: 'ready'; path: string }
  | { type: 'updated' }
  | { type: 'location'; path: string }
  | { type: 'pick'; n: number; element: ElementRef }
  | { type: 'editing' }
  | { type: 'text-cancel' }
  | { type: 'text-commit'; loc: string; tag: string; before: string; after: string }
  | ({ type: 'error' } & PageError)
  | { type: 'escape' }
  | { type: 'viewport'; scrollX: number; scrollY: number; path: string }

/** What a click in the page does: pick the element for the chat, or edit its text. */
type PageMode = 'none' | 'select' | 'text'

export type BridgeCommand =
  | { type: 'hello' }
  | { type: 'mode'; mode: PageMode }
  | { type: 'picks'; keep: Array<number> }
  | { type: 'viewport' }
  | { type: 'scroll'; x: number; y: number }

const str = (value: unknown, max = 2000): value is string =>
  typeof value === 'string' && value.length <= max
const int = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0

function isElement(value: unknown): value is ElementRef {
  const el = value as Partial<ElementRef> | null
  return !!el && str(el.loc, 300) && str(el.tag, 40) && str(el.text, 400) && str(el.path)
}

/** A message from the preview bridge, or null when it isn't one (or is malformed). */
export function parseBridgeEvent(data: unknown): BridgeEvent | null {
  const d = data as Record<string, unknown> | null
  if (!d || typeof d !== 'object' || d['sf'] !== 1 || typeof d['type'] !== 'string') return null
  switch (d['type']) {
    case 'here':
    case 'updated':
    case 'editing':
    case 'text-cancel':
    case 'escape':
      return { type: d['type'] }
    case 'ready':
    case 'location':
      return str(d['path']) ? { type: d['type'], path: d['path'] } : null
    case 'pick':
      return int(d['n']) && isElement(d['element'])
        ? { type: 'pick', n: d['n'], element: d['element'] }
        : null
    case 'text-commit':
      return str(d['loc'], 300) && str(d['before']) && str(d['after'])
        ? {
            type: 'text-commit',
            loc: d['loc'],
            tag: str(d['tag'], 40) && /^[a-z][a-z0-9-]*$/.test(d['tag']) ? d['tag'] : 'text',
            before: d['before'],
            after: d['after'],
          }
        : null
    case 'viewport':
      return int(d['scrollX']) && int(d['scrollY']) && str(d['path'])
        ? { type: 'viewport', scrollX: d['scrollX'], scrollY: d['scrollY'], path: d['path'] }
        : null
    case 'error':
      return str(d['message'])
        ? {
            type: 'error',
            kind: d['kind'] === 'build' ? 'build' : 'runtime',
            message: d['message'],
            stack: str(d['stack'], 4000) ? d['stack'] : '',
            path: str(d['path']) ? d['path'] : '/',
          }
        : null
    default:
      return null
  }
}

/** What the AI gets when the user asks it to fix an error the preview showed. */
export function fixRequest(error: PageError): string {
  const stack = error.stack.split('\n').slice(0, 8).join('\n').trim()
  // A stack trace usually starts with the message already.
  const details = stack.includes(error.message) ? stack : `${error.message}\n${stack}`.trim()
  const what = error.kind === 'build' ? 'a build error' : 'an error'
  return `The preview shows ${what} on page ${error.path}. Find the cause and fix it.\n\n\`\`\`\n${details}\n\`\`\``
}
