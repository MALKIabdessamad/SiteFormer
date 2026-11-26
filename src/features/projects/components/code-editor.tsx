import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { indentWithTab } from '@codemirror/commands'
import { Annotation, Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { oneDark } from '@codemirror/theme-one-dark'

/** Marks document replacements that come from props, so they aren't reported as typing. */
const external = Annotation.define<boolean>()

/** Syntax highlighting by file extension (loaded on demand). */
async function languageFor(path: string) {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'].includes(ext)) {
    const { javascript } = await import('@codemirror/lang-javascript')
    return javascript({
      jsx: ext.includes('x'),
      typescript: ext.startsWith('t') || ext.startsWith('mt') || ext.startsWith('ct'),
    })
  }
  if (['css', 'scss'].includes(ext)) return (await import('@codemirror/lang-css')).css()
  if (['html', 'htm', 'svg', 'xml'].includes(ext))
    return (await import('@codemirror/lang-html')).html()
  if (ext === 'json') return (await import('@codemirror/lang-json')).json()
  if (['md', 'mdx', 'markdown'].includes(ext))
    return (await import('@codemirror/lang-markdown')).markdown()
  return null
}

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '12.5px', backgroundColor: 'transparent' },
  '.cm-scroller': { fontFamily: 'var(--font-mono, ui-monospace, monospace)', lineHeight: '1.6' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
  '&.cm-focused': { outline: 'none' },
})

/**
 * CodeMirror 6 editor. `value` replaces the document only when it changes from outside (a
 * different file, a reload); typing goes out through `onChange`. Cmd/Ctrl+S calls `onSave`.
 */
export default function CodeEditor({
  path,
  value,
  readOnly,
  onChange,
  onSave,
}: {
  path: string
  value: string
  readOnly: boolean
  onChange: (value: string) => void
  onSave: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const language = useRef(new Compartment())
  const editable = useRef(new Compartment())
  const handlers = useRef({ onChange, onSave })
  useEffect(() => {
    handlers.current = { onChange, onSave }
  }, [onChange, onSave])

  // One editor for the component's life.
  useEffect(() => {
    if (!host.current) return
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([
            indentWithTab,
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                handlers.current.onSave()
                return true
              },
            },
          ]),
          oneDark,
          theme,
          language.current.of([]),
          editable.current.of([
            EditorState.readOnly.of(readOnly),
            EditorView.editable.of(!readOnly),
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !update.transactions.some((tr) => tr.annotation(external)))
              handlers.current.onChange(update.state.doc.toString())
          }),
        ],
      }),
    })
    view.current = editor
    return () => {
      editor.destroy()
      view.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- created once; updates below
  }, [])

  // New content from outside (another file, a reload after the agent changed it).
  useEffect(() => {
    const editor = view.current
    if (!editor || editor.state.doc.toString() === value) return
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: value },
      annotations: external.of(true),
    })
  }, [value])

  useEffect(() => {
    view.current?.dispatch({
      effects: editable.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    })
  }, [readOnly])

  useEffect(() => {
    let live = true
    void languageFor(path).then((lang) => {
      if (live) view.current?.dispatch({ effects: language.current.reconfigure(lang ?? []) })
    })
    return () => {
      live = false
    }
  }, [path])

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />
}
