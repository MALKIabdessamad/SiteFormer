import { useCallback, useEffect, useRef, useState } from 'react'
import { referenceLine, type Composer, type ElementRef, type SendOptions } from '~/features/agent'
import { toErrorMessage } from '~/lib/utils/errors'
import { captureSketch, editElementText } from '../api/visual-edit.functions'
import { fixRequest, type BridgeEvent, type PageError } from '../lib/preview-bridge'
import type { Preview } from '../components/preview-panel'
import { usePreviewBridge } from './use-preview-bridge'

/** Select: pick elements for the chat. Text: edit text in place. Draw: sketch on the page. */
export type EditorTool = 'select' | 'text' | 'draw'

/** A drawn line, in CSS pixels of the visible page. */
export type Stroke = Array<[number, number]>

/** Something the tools couldn't do directly; the AI can do it instead. */
type Notice = { message: string; retry?: { text: string; element: ElementRef } }

/**
 * The preview's editing tools (collapsed until opened): pick elements to refer to in the chat,
 * edit text in place (saved straight into the code), or draw on the page and attach the drawing
 * to the next message. Also offers a fix when the page shows an error.
 */
export function useVisualEditor({
  projectId,
  preview,
  frameKey,
  composer,
  agentBusy,
  onAsk,
  onEdited,
  onShowChat,
}: {
  projectId: string
  preview: Preview
  frameKey: string
  composer: Composer
  agentBusy: boolean
  /** Sends a message to the AI (a fix, or a text edit that has to go through the AI). */
  onAsk: (text: string, options?: SendOptions) => void
  /** A text edit was saved: `note` is what the chat now ends with. */
  onEdited: (note: string) => void
  /** Brings the chat into view (phones show one panel at a time). */
  onShowChat: () => void
}) {
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<EditorTool | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState<'saving' | 'capturing' | null>(null)
  const [drawing, setDrawing] = useState<{ view: string; strokes: Array<Stroke> } | null>(null)
  const [pageError, setPageError] = useState<{ frame: string; error: PageError } | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const edits = useRef<Promise<void>>(Promise.resolve())

  // Text can't be edited while the agent is changing the code.
  const tool = chosen === 'text' && agentBusy ? null : chosen
  // Errors mid-run are expected (files half written); offer a fix once the agent is done.
  const error = pageError?.frame === frameKey && !agentBusy ? pageError.error : null
  // A drawing belongs to the page as it was drawn on: a reload or another device size drops it.
  const view = `${frameKey}:${preview.device}`
  const strokes = drawing?.view === view ? drawing.strokes : []
  const setStrokes = (update: (all: Array<Stroke>) => Array<Stroke>) =>
    setDrawing((d) => ({ view, strokes: update(d?.view === view ? d.strokes : []) }))

  const setTool = (next: EditorTool | null) => {
    setChosen(next)
    setNotice(null)
    setEditing(false)
    if (next !== 'draw') setDrawing(null)
  }

  /** Saves typed text; when it can't be saved directly, the page reloads and the AI is offered. */
  const saveText = (loc: string, before: string, after: string) => {
    const element: ElementRef = { loc, tag: 'text', text: before, path: preview.shownPath }
    edits.current = edits.current.then(async () => {
      setBusy('saving')
      try {
        const result = await editElementText({ data: { projectId, loc, before, after } })
        if (result.status === 'saved') onEdited(result.note)
        if (result.status === 'unsupported') {
          setNotice({
            message: result.message,
            retry: { text: `Change this text to “${after}”.`, element },
          })
          preview.reload()
        }
      } catch (err) {
        setNotice({ message: toErrorMessage(err) })
        preview.reload()
      } finally {
        setBusy(null)
      }
    })
  }

  const bridge = usePreviewBridge(preview.url, frameKey, (event: BridgeEvent) => {
    switch (event.type) {
      case 'ready':
      case 'location':
        preview.observe(event.path)
        break
      case 'pick':
        composer.setPicks((picks) =>
          picks.some((p) => p.n === event.n)
            ? picks
            : [...picks, { n: event.n, element: event.element }],
        )
        break
      case 'editing':
        setNotice(null)
        setEditing(true)
        break
      case 'text-cancel':
        setEditing(false)
        break
      case 'text-commit':
        setEditing(false)
        saveText(event.loc, event.before, event.after)
        break
      case 'error':
        setPageError({ frame: frameKey, error: event })
        break
      case 'updated':
        setPageError(null)
        break
      case 'escape':
        setTool(null)
        break
    }
  })
  const { connected, post, viewport } = bridge

  // What a click in the page does follows the chosen tool (again after every reload).
  const pageMode = tool === 'select' ? 'select' : tool === 'text' ? 'text' : 'none'
  useEffect(() => {
    if (connected) post({ type: 'mode', mode: pageMode })
  }, [connected, post, pageMode])

  // Elements removed from the chat box (or sent) lose their outline in the page.
  const pickNumbers = composer.picks.map((pick) => pick.n).join(',')
  useEffect(() => {
    if (!connected) return
    const keep = pickNumbers ? pickNumbers.split(',').map(Number) : []
    post({ type: 'picks', keep, next: Math.max(0, ...keep) + 1 })
  }, [connected, post, pickNumbers])

  // A tool is on but the page never answered (e.g. it loaded while its dev server restarted with
  // the editor support): after a few seconds, offer a reload.
  const [stalledFor, setStalledFor] = useState<string | null>(null)
  const waiting = tool !== null && !connected
  useEffect(() => {
    if (!waiting) return
    const timer = setTimeout(() => setStalledFor(frameKey), 6000)
    return () => clearTimeout(timer)
  }, [waiting, frameKey])

  const close = useCallback(() => {
    setOpen(false)
    setChosen(null)
    setDrawing(null)
    setNotice(null)
    setEditing(false)
  }, [])

  const showChat = () => {
    onShowChat()
    composer.focus()
  }

  return {
    bridge,
    open,
    toggle: () => (open ? close() : setOpen(true)),
    close,
    tool,
    /** Picks a tool (picking the active one again turns it off). */
    choose: (next: EditorTool) => setTool(tool === next ? null : next),
    editing,
    busy,
    stalled: waiting && stalledFor === frameKey,
    reload: preview.reload,
    error,
    dismissError: () => setPageError(null),
    fix: () => {
      if (!error) return
      onAsk(fixRequest(error), { mode: 'build' })
      setPageError(null)
    },
    notice,
    dismissNotice: () => setNotice(null),
    askInstead: () => {
      if (!notice?.retry) return
      onAsk(`${notice.retry.text}\n${referenceLine(notice.retry.element)}`)
      setNotice(null)
    },
    showChat,
    strokes,
    addStroke: (stroke: Stroke) => setStrokes((all) => [...all, stroke]),
    undoStroke: () => setStrokes((all) => all.slice(0, -1)),
    clearStrokes: () => setDrawing(null),
    /** Scrolls the page under the drawing layer (only before drawing: lines stay where drawn). */
    scrollPage: (x: number, y: number) => {
      if (strokes.length === 0 && (x || y)) post({ type: 'scroll', x, y })
    },
    /** Renders the page with the drawing on it and attaches it to the message being written. */
    attachDrawing: async () => {
      const frame = bridge.frame.current
      if (!frame || strokes.length === 0) return
      setBusy('capturing')
      setNotice(null)
      try {
        const view = await viewport()
        const result = await captureSketch({
          data: {
            projectId,
            path: view?.path ?? preview.shownPath,
            width: Math.round(frame.clientWidth),
            height: Math.round(frame.clientHeight),
            scrollX: view?.scrollX ?? 0,
            scrollY: view?.scrollY ?? 0,
            strokes,
          },
        })
        const bytes = Uint8Array.from(atob(result.image), (c) => c.charCodeAt(0))
        composer.attach(
          new File([bytes], result.upload.name, { type: result.upload.mime }),
          result.upload,
        )
        setDrawing(null)
        setChosen(null)
        showChat()
      } catch (err) {
        setNotice({ message: toErrorMessage(err) })
      } finally {
        setBusy(null)
      }
    },
  }
}

export type VisualEditor = ReturnType<typeof useVisualEditor>
