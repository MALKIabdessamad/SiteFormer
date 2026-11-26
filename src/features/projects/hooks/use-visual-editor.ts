import { useCallback, useEffect, useRef, useState } from 'react'
import {
  referenceLine,
  uploadFile,
  type Composer,
  type ElementRef,
  type SendOptions,
  type Upload,
} from '~/features/agent'
import { toErrorMessage } from '~/lib/utils/errors'
import {
  editElementStyle,
  editElementText,
  replaceElementImage,
  type VisualEditResult,
} from '../api/visual-edit.functions'
import {
  fixRequest,
  type BridgeEvent,
  type EditorTool,
  type ElementInfo,
  type PageError,
} from '../lib/preview-bridge'
import { setStyle, type StyleGroup } from '../lib/tailwind-classes'
import type { Preview } from '../components/preview-panel'
import { usePreviewBridge } from './use-preview-bridge'

export type AskOptions = SendOptions & { element?: ElementRef }

/** A direct edit couldn't be made; the AI can do it instead. */
export type Notice = {
  message: string
  retry?: { text: string; element: ElementRef; uploads?: Array<Upload> }
}

const toRef = ({ loc, tag, text, path }: ElementInfo): ElementRef => ({ loc, tag, text, path })

const STYLE_WORDS: Record<StyleGroup, string> = {
  textColor: 'text color',
  backgroundColor: 'background',
  fontSize: 'font size',
  fontWeight: 'font weight',
  textAlign: 'text alignment',
  borderRadius: 'corner rounding',
  padding: 'padding',
}

/**
 * The preview's editing tools: pick elements (then edit text/styles/images directly, or ask the
 * AI), pin notes for the chat, and offer a fix when the page shows an error.
 */
export function useVisualEditor({
  projectId,
  preview,
  frameKey,
  composer,
  agentBusy,
  onAsk,
  onEdited,
}: {
  projectId: string
  preview: Preview
  frameKey: string
  composer: Composer
  agentBusy: boolean
  /** Sends a message to the AI (from the selection card, a fix, a fallback). */
  onAsk: (text: string, options?: SendOptions) => void
  /** A direct edit was saved (the chat shows a note). */
  onEdited: () => void
}) {
  const [tool, setToolState] = useState<EditorTool>('none')
  const [selection, setSelection] = useState<{ frame: string; element: ElementInfo } | null>(null)
  const [editing, setEditing] = useState(false)
  const [pageError, setPageError] = useState<{ frame: string; error: PageError } | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [pending, setPending] = useState(0)
  const chain = useRef<Promise<void>>(Promise.resolve())
  const styleTimers = useRef(new Map<StyleGroup, ReturnType<typeof setTimeout>>())

  const selected = selection?.frame === frameKey ? selection.element : null
  // Errors mid-run are expected (files half written); offer a fix once the agent is done.
  const error = pageError?.frame === frameKey && !agentBusy ? pageError.error : null

  /** Runs direct edits one after another; a refused one reloads the page to drop the preview. */
  const save = useCallback(
    (work: () => Promise<VisualEditResult>, fallback: (message: string) => Notice) => {
      setPending((n) => n + 1)
      chain.current = chain.current.then(async () => {
        try {
          const result = await work()
          if (result.status === 'unsupported') {
            setNotice(fallback(result.message))
            preview.reload()
          } else if (result.status === 'saved') onEdited()
        } catch (err) {
          setNotice({ message: toErrorMessage(err) })
          preview.reload()
        } finally {
          setPending((n) => n - 1)
        }
      })
    },
    [preview, onEdited],
  )

  const swapImage = (element: ElementInfo, file: File) => {
    let upload: Upload | undefined
    save(
      async () => {
        upload = await uploadFile(projectId, file)
        return replaceElementImage({ data: { projectId, loc: element.loc, uploadId: upload.id } })
      },
      (message) => ({
        message,
        ...(upload && {
          retry: {
            text: 'Use the attached image here.',
            element: toRef(element),
            uploads: [upload],
          },
        }),
      }),
    )
  }

  const setTool = (next: EditorTool) => {
    setToolState(next)
    setSelection(null)
    setNotice(null)
    setEditing(false)
  }

  const bridge = usePreviewBridge(preview.url, frameKey, (event: BridgeEvent) => {
    switch (event.type) {
      case 'ready':
      case 'location':
        preview.observe(event.path)
        break
      case 'select':
        setSelection({ frame: frameKey, element: event.element })
        if (!event.refresh) {
          setNotice(null)
          setEditing(false)
        }
        break
      case 'editing':
        setEditing(true)
        break
      case 'text-cancel':
        setEditing(false)
        break
      case 'text-commit': {
        setEditing(false)
        const element: ElementRef = selected
          ? toRef(selected)
          : { loc: event.loc, tag: 'element', text: event.before, path: preview.shownPath }
        save(
          () =>
            editElementText({
              data: { projectId, loc: event.loc, before: event.before, after: event.after },
            }),
          (message) => ({
            message,
            retry: { text: `Change this text to “${event.after}”.`, element },
          }),
        )
        break
      }
      case 'pin':
        composer.setPins((pins) => [
          ...pins,
          { n: event.n, element: toRef(event.element), note: '' },
        ])
        break
      case 'image-drop':
        swapImage(event.element, event.file)
        break
      case 'error':
        setPageError({ frame: frameKey, error: event })
        break
      case 'updated':
        setPageError(null)
        break
      case 'escape':
        setTool('none')
        break
    }
  })
  const { connected, post } = bridge

  // The page follows the chosen tool (again after every reload).
  useEffect(() => {
    if (connected) post({ type: 'mode', mode: tool })
  }, [connected, post, tool])

  // Pins removed in the chat (or sent) disappear from the page.
  const pinNumbers = composer.pins.map((pin) => pin.n).join(',')
  useEffect(() => {
    if (!connected) return
    const keep = pinNumbers ? pinNumbers.split(',').map(Number) : []
    post({ type: 'pins', keep, next: Math.max(0, ...keep) + 1 })
  }, [connected, post, pinNumbers])

  useEffect(() => {
    const timers = styleTimers.current
    return () => timers.forEach((timer) => clearTimeout(timer))
  }, [])

  return {
    bridge,
    tool,
    setTool,
    selected,
    editing,
    saving: pending > 0,
    error,
    dismissError: () => setPageError(null),
    notice,
    dismissNotice: () => setNotice(null),
    deselect: () => {
      setSelection(null)
      post({ type: 'deselect' })
    },
    editText: () => post({ type: 'edit-text' }),
    /** Shows a style at once in the page and saves it after a short pause. */
    setElementStyle: (group: StyleGroup, value: string | null) => {
      if (!selected) return
      const next = setStyle(selected.classes, group, value)
      const before = new Set(selected.classes.split(/\s+/).filter(Boolean))
      const after = new Set(next.split(/\s+/).filter(Boolean))
      post({
        type: 'classes',
        add: [...after].filter((c) => !before.has(c)),
        remove: [...before].filter((c) => !after.has(c)),
      })
      setSelection({ frame: frameKey, element: { ...selected, classes: next } })
      const element = toRef(selected)
      clearTimeout(styleTimers.current.get(group))
      styleTimers.current.set(
        group,
        setTimeout(
          () =>
            save(
              () => editElementStyle({ data: { projectId, loc: element.loc, group, value } }),
              (message) => ({
                message,
                retry: {
                  text: `Change its ${STYLE_WORDS[group]}${value ? ` to Tailwind ${value}` : ' back to the default'}.`,
                  element,
                },
              }),
            ),
          450,
        ),
      )
    },
    swapImage,
    /** The theme was saved (from the theme panel). */
    themeSaved: onEdited,
    /** Asks the AI, pointing at an element when given. */
    ask: (text: string, { element, ...options }: AskOptions = {}) => {
      onAsk(
        [text.trim(), element ? referenceLine(element) : ''].filter(Boolean).join('\n\n'),
        options,
      )
      setNotice(null)
    },
    fix: () => {
      if (!error) return
      onAsk(fixRequest(error), { mode: 'build' })
      setPageError(null)
    },
    toRef,
  }
}

export type VisualEditor = ReturnType<typeof useVisualEditor>
