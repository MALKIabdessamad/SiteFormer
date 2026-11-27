import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseBridgeEvent, type BridgeCommand, type BridgeEvent } from '../lib/preview-bridge'

type Viewport = { scrollX: number; scrollY: number; path: string }

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
  const handler = useRef(onEvent)
  const currentKey = useRef(frameKey)
  const viewportWaiters = useRef<Array<(viewport: Viewport) => void>>([])
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
      if (event.type === 'viewport') {
        const waiters = viewportWaiters.current
        viewportWaiters.current = []
        waiters.forEach((resolve) => resolve(event))
        return
      }
      handler.current(event)
    }
    window.addEventListener('message', listen)
    return () => window.removeEventListener('message', listen)
  }, [origin, post])

  /** Where the page is scrolled to (null if the bridge doesn't answer quickly). */
  const viewport = useCallback(
    () =>
      new Promise<Viewport | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), 1500)
        viewportWaiters.current.push((value) => {
          clearTimeout(timer)
          resolve(value)
        })
        post({ type: 'viewport' })
      }),
    [post],
  )

  return {
    frame,
    /** The bridge in the current page answered (older projects get it on their next open). */
    connected: readyFor === frameKey,
    post,
    viewport,
    /** Call when the frame loaded: greets the bridge (it also announces itself). */
    hello: useCallback(() => post({ type: 'hello' }), [post]),
  }
}
