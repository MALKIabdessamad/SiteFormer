import { useCallback, useMemo, useRef, useState } from 'react'
import type { ProjectMode } from '~/features/projects'
import type { Upload } from '../lib/attachments'
import type { ElementRef } from '../lib/references'

/** An element picked in the preview (Select): it goes with the next message as context. */
export type Pick = { n: number; element: ElementRef }

/** A message typed while the agent was busy; it sends when the agent is free. */
export type QueuedMessage = { id: string; text: string; uploads: Array<Upload> }

export type SendOptions = { mode?: ProjectMode; uploads?: Array<Upload> }

/** What the chat does for the rest of the workspace (registered by the chat while mounted). */
type ChatHandle = {
  send: (text: string, options?: SendOptions) => Promise<void>
  /** Shows a note the server just added to the transcript (an edit made outside the chat). */
  addNote: (note: string) => void
  /** Adds an already stored file (a drawing on the preview) to the message being written. */
  attach: (file: File, upload: Upload) => void
  /** Puts the cursor in the message box. */
  focus: () => void
}

/**
 * Composer state that outlives the chat component (it remounts to reconnect): the draft, the
 * elements picked in the preview and queued messages, plus a handle for the rest of the workspace.
 */
export function useComposer() {
  const [picks, setPicks] = useState<Array<Pick>>([])
  const [queue, setQueue] = useState<Array<QueuedMessage>>([])
  const draft = useRef('')
  const handle = useRef<ChatHandle | null>(null)

  const readDraft = useCallback(() => draft.current, [])
  const saveDraft = useCallback((value: string) => {
    draft.current = value
  }, [])
  /** The chat registers its handle; returns the function that unregisters it. */
  const register = useCallback((next: ChatHandle) => {
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

  const addNote = useCallback((note: string) => handle.current?.addNote(note), [])
  const attach = useCallback(
    (file: File, upload: Upload) => handle.current?.attach(file, upload),
    [],
  )
  const focus = useCallback(() => handle.current?.focus(), [])

  return useMemo(
    () => ({
      picks,
      setPicks,
      queue,
      setQueue,
      readDraft,
      saveDraft,
      register,
      send,
      addNote,
      attach,
      focus,
    }),
    [picks, queue, readDraft, saveDraft, register, send, addNote, attach, focus],
  )
}

export type Composer = ReturnType<typeof useComposer>
