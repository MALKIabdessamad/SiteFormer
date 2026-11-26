import { useCallback, useMemo, useRef, useState } from 'react'
import type { ProjectMode } from '~/features/projects'
import type { Upload } from '../lib/attachments'
import type { ElementRef } from '../lib/references'

/** A note pinned on an element in the preview (Annotate), written in the composer. */
export type Pin = { n: number; element: ElementRef; note: string }

/** A message typed while the agent was busy; it sends when the agent is free. */
export type QueuedMessage = { id: string; text: string; uploads: Array<Upload> }

export type SendOptions = { mode?: ProjectMode; uploads?: Array<Upload> }

/** How the chat sends a message (registered by the chat while it's mounted). */
type SendHandle = { send: (text: string, options?: SendOptions) => Promise<void> }

/**
 * Composer state that outlives the chat component (it remounts to reload the transcript):
 * the draft, annotation pins and queued messages, plus sending from elsewhere in the workspace.
 */
export function useComposer() {
  const [pins, setPins] = useState<Array<Pin>>([])
  const [queue, setQueue] = useState<Array<QueuedMessage>>([])
  const draft = useRef('')
  const handle = useRef<SendHandle | null>(null)

  const readDraft = useCallback(() => draft.current, [])
  const saveDraft = useCallback((value: string) => {
    draft.current = value
  }, [])
  /** The chat registers how to send; returns the function that unregisters it. */
  const register = useCallback((next: SendHandle) => {
    handle.current = next
    return () => {
      if (handle.current === next) handle.current = null
    }
  }, [])
  /** Sends (or queues, while the agent works) a message through the chat. */
  const send = useCallback(
    (text: string, options?: SendOptions) =>
      handle.current?.send(text, options) ?? Promise.resolve(),
    [],
  )

  return useMemo(
    () => ({ pins, setPins, queue, setQueue, readDraft, saveDraft, register, send }),
    [pins, queue, readDraft, saveDraft, register, send],
  )
}

export type Composer = ReturnType<typeof useComposer>
