/**
 * Messages between the editor and the bridge inside the preview (see
 * src/lib/server/sandbox/editor/bridge.js.txt). Everything arrives from the user's own site, so
 * it is checked before use, and the server validates again.
 */
import type { ElementRef } from '~/features/agent'

export type ElementInfo = ElementRef & {
  /** One plain text child: it can be typed over in place. */
  textEditable: boolean
  /** An <img>'s src. */
  image: string | null
  /** The element's classes in the page (Tailwind). */
  classes: string
}

export type PageError = { kind: 'runtime' | 'build'; message: string; stack: string; path: string }

export type BridgeEvent =
  | { type: 'here' }
  | { type: 'ready'; path: string; theme: Record<string, string> }
  | { type: 'updated'; theme: Record<string, string> }
  | { type: 'location'; path: string }
  | { type: 'select'; element: ElementInfo; refresh?: boolean }
  | { type: 'editing' }
  | { type: 'text-cancel' }
  | { type: 'text-commit'; loc: string; before: string; after: string }
  | { type: 'pin'; n: number; element: ElementInfo }
  | { type: 'image-drop'; element: ElementInfo; file: File }
  | ({ type: 'error' } & PageError)
  | { type: 'escape' }

export type BridgeCommand =
  | { type: 'hello' }
  | { type: 'mode'; mode: EditorTool }
  | { type: 'deselect' }
  | { type: 'edit-text' }
  | { type: 'classes'; add: Array<string>; remove: Array<string> }
  | { type: 'pins'; keep: Array<number>; next: number }
  | { type: 'theme'; vars: Record<string, string | null> }

export type EditorTool = 'none' | 'select' | 'annotate'

const str = (value: unknown, max = 2000): value is string =>
  typeof value === 'string' && value.length <= max

function isElement(value: unknown): value is ElementInfo {
  const el = value as Partial<ElementInfo> | null
  return (
    !!el &&
    str(el.loc, 300) &&
    str(el.tag, 40) &&
    str(el.text, 400) &&
    str(el.path, 2000) &&
    str(el.classes, 2100) &&
    typeof el.textEditable === 'boolean'
  )
}

const record = (value: unknown): Record<string, string> =>
  value && typeof value === 'object'
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => str(entry[1], 200) && /^[\w-]+$/.test(entry[0]),
        ),
      )
    : {}

/** A message from the preview bridge, or null when it isn't one (or is malformed). */
export function parseBridgeEvent(data: unknown): BridgeEvent | null {
  const d = data as Record<string, unknown> | null
  if (!d || typeof d !== 'object' || d['sf'] !== 1 || typeof d['type'] !== 'string') return null
  switch (d['type']) {
    case 'here':
    case 'editing':
    case 'text-cancel':
    case 'escape':
      return { type: d['type'] }
    case 'ready':
      return str(d['path']) ? { type: 'ready', path: d['path'], theme: record(d['theme']) } : null
    case 'updated':
      return { type: 'updated', theme: record(d['theme']) }
    case 'location':
      return str(d['path']) ? { type: 'location', path: d['path'] } : null
    case 'select':
      return isElement(d['element'])
        ? { type: 'select', element: d['element'], refresh: d['refresh'] === true }
        : null
    case 'pin':
      return typeof d['n'] === 'number' && isElement(d['element'])
        ? { type: 'pin', n: d['n'], element: d['element'] }
        : null
    case 'text-commit':
      return str(d['loc'], 300) && str(d['before']) && str(d['after'])
        ? { type: 'text-commit', loc: d['loc'], before: d['before'], after: d['after'] }
        : null
    case 'image-drop':
      return isElement(d['element']) && d['file'] instanceof File
        ? { type: 'image-drop', element: d['element'], file: d['file'] }
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
  const stack = error.stack.split('\n').slice(0, 8).join('\n')
  return [
    `The preview shows ${error.kind === 'build' ? 'a build error' : 'an error'} on page ${error.path}. Find the cause and fix it.`,
    '',
    '```',
    error.message,
    stack,
    '```',
  ]
    .filter((line, i) => i < 3 || line !== '')
    .join('\n')
}
