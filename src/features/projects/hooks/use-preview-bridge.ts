import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseBridgeEvent, type BridgeCommand, type BridgeEvent } from '../lib/preview-bridge'

/**
 * Talks to the editor bridge inside the preview frame (only with that frame, only with the
 * preview's origin). `frameKey` changes whenever the frame reloads: the connection and anything
 * tied to the old page start over.
 */
export function usePreviewBridge(
  previewUrl: string | null,
  frameKey: string,
  onEvent: (event: BridgeEvent) => void,
) {
  const frame = useRef<HTMLIFrameElement | null>(null)
  const origin = useMemo(() => {
    try {
      return previewUrl ? new URL(previewUrl).origin : null
    } catch {
      return null
    }
  }, [previewUrl])
  const [readyFor, setReadyFor] = useState<string | null>(null)
  const [theme, setTheme] = useState<Record<string, string>>({})
  const handler = useRef(onEvent)
  const currentKey = useRef(frameKey)
  useEffect(() => {
    handler.current = onEvent
    currentKey.current = frameKey
  })

  const post = useCallback(
    (command: BridgeCommand) => {
      if (origin) frame.current?.contentWindow?.postMessage({ sf: 1, ...command }, origin)
    },
    [origin],
  )

  useEffect(() => {
    if (!origin) return
    const listen = (e: MessageEvent) => {
      if (e.origin !== origin || !frame.current || e.source !== frame.current.contentWindow) return
      const event = parseBridgeEvent(e.data)
      if (!event) return
      if (event.type === 'here') return post({ type: 'hello' })
      if (event.type === 'ready') setReadyFor(currentKey.current)
      if (event.type === 'ready' || event.type === 'updated') setTheme(event.theme)
      handler.current(event)
    }
    window.addEventListener('message', listen)
    return () => window.removeEventListener('message', listen)
  }, [origin, post])

  return {
    frame,
    /** The bridge in the current page answered (older projects get it on their next open). */
    connected: readyFor === frameKey,
    /** The site's theme colors (for real swatches). */
    theme,
    post,
    /** Call when the frame loaded: greets the bridge (it also announces itself). */
    hello: useCallback(() => post({ type: 'hello' }), [post]),
  }
}
