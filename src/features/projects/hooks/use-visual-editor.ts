import { useEffect, useRef, useState } from 'react'
import { referenceLine, type Composer, type ElementRef, type SendOptions } from '~/features/agent'
import { toErrorMessage } from '~/lib/utils/errors'
import { captureSketch, saveTextEdits } from '../api/visual-edit.functions'
import { fixRequest, type BridgeEvent, type PageError } from '../lib/preview-bridge'
import type { Preview } from '../components/preview-panel'
import { usePreviewBridge } from './use-preview-bridge'

/** Select: refer to an element in the chat. Text: change texts in place. Draw: mark up the page. */
export type EditorTool = 'select' | 'text' | 'draw'

/** A drawn line, in CSS pixels of the visible page. */
export type Stroke = Array<[number, number]>

/** A text changed in the page that isn't saved yet. */
type TextChange = { loc: string; tag: string; before: string; after: string }

/** Something the tools couldn't do; `ask` is the message that has the AI do it instead. */
type Notice = { message: string; ask?: string }

type Drawing = { strokes: Array<Stroke>; undone: Array<Stroke> }
const EMPTY: Drawing = { strokes: [], undone: [] }

const sameText = (a: string, b: string) =>
  a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim()

/**
 * The preview's editing tools (closed until opened): pick an element to refer to in the chat,
 * change texts in place (kept in the page until Save writes them into the code, or Cancel), or
 * draw on the page and attach the drawing to the next message. Also offers a fix when the page
 * shows an error.
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
  /** Sends a message to the AI (a fix, or a text change that has to go through the AI). */
  onAsk: (text: string, options?: SendOptions) => void
  /** Text changes were saved: `note` is what the chat now ends with. */
  onEdited: (note: string) => void
  /** Brings the chat into view (phones show one panel at a time). */
  onShowChat: () => void
}) {
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<EditorTool | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState<'saving' | 'capturing' | null>(null)
  // Changed texts and drawn lines belong to the page as it is: a reload (or another device size,
  // for drawings) drops them.
  const [changes, setChanges] = useState<{ frame: string; list: Array<TextChange> } | null>(null)
  const [drawing, setDrawing] = useState<({ view: string } & Drawing) | null>(null)
  const [pageError, setPageError] = useState<{ frame: string; error: PageError } | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  // Texts can't be changed while the agent is changing the code.
  const tool = chosen === 'text' && agentBusy ? null : chosen
  // Errors mid-run are expected (files half written); offer a fix once the agent is done.
  const error = pageError?.frame === frameKey && !agentBusy ? pageError.error : null
  const texts = changes?.frame === frameKey ? changes.list : []
  const view = `${frameKey}:${preview.device}`
  const sketch = drawing?.view === view ? drawing : EMPTY
  const redraw = (update: (current: Drawing) => Drawing) =>
    setDrawing((d) => ({ view, ...update(d?.view === view ? d : EMPTY) }))

  /**
   * Leaving a tool undoes what it started and didn't finish: Select's element leaves the message
   * (and its outline the page), unsent drawing lines go, a text being typed is put back.
   */
  const setTool = (next: EditorTool | null) => {
    if (chosen === 'select' && next !== 'select' && composer.picks.length) composer.setPicks([])
    setChosen(next)
    setNotice(null)
    setEditing(false)
    if (next !== 'draw') setDrawing(null)
  }

  /** Back to the tools (not while changed texts wait to be saved or cancelled, or mid-save). */
  const back = () => {
    if (!texts.length && !busy) setTool(null)
  }

  const bridge = usePreviewBridge(preview.url, frameKey, (event: BridgeEvent) => {
    switch (event.type) {
      case 'ready':
      case 'location':
        preview.observe(event.path)
        break
      case 'pick':
        // One element at a time: a new pick replaces the last one.
        composer.setPicks([{ n: event.n, element: event.element }])
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
        setChanges((c) => {
          const list = c?.frame === frameKey ? c.list : []
          // Changed again: still compared with what the code has.
          const before = list.find((x) => x.loc === event.loc)?.before ?? event.before
          const rest = list.filter((x) => x.loc !== event.loc)
          const change = { loc: event.loc, tag: event.tag, before, after: event.after }
          return { frame: frameKey, list: sameText(before, event.after) ? rest : [...rest, change] }
        })
        break
      case 'error':
        setPageError({ frame: frameKey, error: event })
        break
      case 'updated':
        setPageError(null)
        break
      case 'escape':
        back()
        break
    }
  })
  const { connected, post, viewport } = bridge

  // What a click in the page does follows the chosen tool (again after every reload).
  const pageMode = tool === 'select' ? 'select' : tool === 'text' ? 'text' : 'none'
  useEffect(() => {
    if (connected) post({ type: 'mode', mode: pageMode })
  }, [connected, post, pageMode])

  // The picked element loses its outline in the page once it leaves the chat box (or is sent).
  const pickNumbers = composer.picks.map((pick) => pick.n).join(',')
  useEffect(() => {
    if (connected)
      post({ type: 'picks', keep: pickNumbers ? pickNumbers.split(',').map(Number) : [] })
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

  /** Drops the changed texts: the page reloads and shows what the code has. */
  const cancelTexts = () => {
    setChanges(null)
    setEditing(false)
    setNotice(null)
    preview.reload()
  }

  // Esc goes back to the tools from anywhere in the editor too: a click in the page never moves
  // the keyboard there. Not while typing in a field, or with a menu open (Esc closes that).
  const backLatest = useRef(back)
  useEffect(() => {
    backLatest.current = back
  })
  useEffect(() => {
    if (tool === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const active = document.activeElement as HTMLElement | null
      if (
        active?.isContentEditable ||
        active?.closest('input, textarea, select, [role=menu], [role=dialog], [role=listbox]')
      ) {
        return
      }
      backLatest.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tool])

  /** Closing the tools leaves nothing behind (unsaved texts too). */
  const close = () => {
    if (texts.length) cancelTexts()
    if (composer.picks.length) composer.setPicks([])
    setOpen(false)
    setChosen(null)
    setDrawing(null)
    setNotice(null)
    setEditing(false)
  }

  const showChat = () => {
    onShowChat()
    composer.focus()
  }

  /** Writes the changed texts into the code (one checkpoint); what can't be saved goes to the AI. */
  const saveTexts = async () => {
    if (!texts.length || busy) return
    const list = texts
    setBusy('saving')
    setNotice(null)
    try {
      const result = await saveTextEdits({
        data: { projectId, edits: list.map(({ loc, before, after }) => ({ loc, before, after })) },
      })
      setChanges(null)
      if (result.note) onEdited(result.note)
      if (result.failed.length) {
        const ask = result.failed
          .map((failed) => {
            const change = list.find((x) => x.loc === failed.loc)
            const element: ElementRef = {
              loc: failed.loc,
              tag: change?.tag ?? 'text',
              text: change?.before ?? '',
              path: preview.shownPath,
            }
            return `Change this text to “${failed.after}”.\n${referenceLine(element)}`
          })
          .join('\n\n')
        setNotice({
          message:
            result.failed.length === 1
              ? result.failed[0]!.message
              : `${result.failed.length} texts come from code, so they can’t be saved here.`,
          ask,
        })
        preview.reload() // the page shows what the code has again
      }
    } catch (err) {
      setNotice({ message: toErrorMessage(err) }) // the changes stay, to save again
    } finally {
      setBusy(null)
    }
  }

  return {
    bridge,
    open,
    toggle: () => (open ? close() : setOpen(true)),
    close,
    tool,
    /** Picks a tool (picking the active one again turns it off). */
    choose: (next: EditorTool) => setTool(tool === next ? null : next),
    /** Back to the list of tools. */
    back,
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
      if (!notice?.ask) return
      onAsk(notice.ask)
      setNotice(null)
    },
    showChat,
    /** Texts changed in the page, not saved yet. */
    texts,
    saveTexts,
    cancelTexts,
    strokes: sketch.strokes,
    canRedo: sketch.undone.length > 0,
    addStroke: (stroke: Stroke) =>
      redraw(({ strokes }) => ({ strokes: [...strokes, stroke], undone: [] })),
    undoStroke: () =>
      redraw(({ strokes, undone }) =>
        strokes.length
          ? { strokes: strokes.slice(0, -1), undone: [...undone, strokes.at(-1)!] }
          : { strokes, undone },
      ),
    redoStroke: () =>
      redraw(({ strokes, undone }) =>
        undone.length
          ? { strokes: [...strokes, undone.at(-1)!], undone: undone.slice(0, -1) }
          : { strokes, undone },
      ),
    clearStrokes: () => setDrawing(null),
    /** Scrolls the page under the drawing layer (only before drawing: lines stay where drawn). */
    scrollPage: (x: number, y: number) => {
      if (sketch.strokes.length === 0 && (x || y)) post({ type: 'scroll', x, y })
    },
    /** Renders the page with the drawing on it and attaches it to the message being written. */
    attachDrawing: async () => {
      const frame = bridge.frame.current
      if (!frame || sketch.strokes.length === 0) return
      setBusy('capturing')
      setNotice(null)
      try {
        const place = await viewport()
        const result = await captureSketch({
          data: {
            projectId,
            path: place?.path ?? preview.shownPath,
            width: Math.round(frame.clientWidth),
            height: Math.round(frame.clientHeight),
            scrollX: place?.scrollX ?? 0,
            scrollY: place?.scrollY ?? 0,
            strokes: sketch.strokes,
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
