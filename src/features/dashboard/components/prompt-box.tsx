import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { ArrowUp, Loader2 } from 'lucide-react'
import { AttachButton, AttachmentChips, type Attachment } from '~/features/agent'
import {
  PROMPT_MAX_LENGTH as MAX_LENGTH,
  PROMPT_MIN_LENGTH as MIN_LENGTH,
} from '~/features/projects'
import { storage } from '~/lib/utils/storage'

export type PromptBoxHandle = {
  focus: () => void
  clear: () => void
}

type PromptBoxProps = {
  onSubmit: (text: string) => void
  busy?: boolean
  ref?: Ref<PromptBoxHandle>
  /** Files to send with the first prompt (logo, photos, copy). */
  attachments?: {
    items: Array<Attachment>
    notice: string
    add: (files: Array<File>) => void
    remove: (key: string) => void
  }
}

const MAX_HEIGHT = 220
const DRAFT_KEY = 'siteform:draft'

/** Auto-growing prompt input. Enter submits, Shift+Enter adds a line. Drafts survive reloads. */
export function PromptBox({ onSubmit, busy = false, ref, attachments }: PromptBoxProps) {
  const [text, setText] = useState(() => storage.get(DRAFT_KEY, 'session') ?? '')
  const textarea = useRef<HTMLTextAreaElement>(null)

  useImperativeHandle(ref, () => ({
    focus: () => textarea.current?.focus(),
    clear: () => setText(''),
  }))

  useEffect(() => {
    storage.set(DRAFT_KEY, text || null, 'session')
    const el = textarea.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, MAX_HEIGHT) + 'px'
  }, [text])

  const trimmed = text.trim()
  const ready = trimmed.length >= MIN_LENGTH && !busy
  const submit = () => {
    if (ready) onSubmit(trimmed)
  }

  return (
    <div
      className="w-full max-w-[670px] rounded-3xl p-3 text-left box-sculpted focus-within:border-signal/70 sm:p-3.5"
      onDragOver={(e) => {
        if (attachments && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault()
      }}
      onDrop={(e) => {
        if (!attachments) return
        e.preventDefault()
        attachments.add(Array.from(e.dataTransfer.files))
      }}
    >
      {attachments && <AttachmentChips items={attachments.items} onRemove={attachments.remove} />}
      <label htmlFor="prompt" className="sr-only">
        Describe your website
      </label>
      <textarea
        id="prompt"
        ref={textarea}
        rows={2}
        value={text}
        maxLength={MAX_LENGTH}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files)
          if (attachments && files.length) {
            e.preventDefault()
            attachments.add(files)
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
          }
        }}
        enterKeyHint="send"
        placeholder="A site for my bakery with a menu, opening hours and a contact form…"
        className="block max-h-[220px] min-h-[52px] w-full resize-none bg-transparent px-1 text-base leading-relaxed text-ink outline-none placeholder:text-faint"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1 text-xs text-faint" aria-live="polite">
          {attachments && (
            <AttachButton
              onFiles={attachments.add}
              disabled={busy}
              count={attachments.items.length}
            />
          )}
          {attachments?.notice ? (
            <span className="truncate text-danger">{attachments.notice}</span>
          ) : text.length > MAX_LENGTH * 0.9 ? (
            `${text.length}/${MAX_LENGTH}`
          ) : (
            ''
          )}
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={!ready}
          className="inline-flex h-11 min-w-[104px] shrink-0 btn-sculpted items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold tracking-wide disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <ArrowUp className="h-4 w-4" aria-hidden />
          )}
          {busy ? 'Creating' : 'Build'}
        </button>
      </div>
    </div>
  )
}
