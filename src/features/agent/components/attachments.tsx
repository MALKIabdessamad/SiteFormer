import { useEffect, useRef, useState } from 'react'
import { FileText, Loader2, Paperclip, X } from 'lucide-react'
import { getSupabase } from '~/lib/supabase/client'
import { cn } from '~/lib/utils/cn'
import type { Attachment } from '../hooks/use-attachments'
import { ACCEPT, MAX_ATTACHMENTS } from '../lib/attachments'
import { ScreenshotImage } from './screenshot-image'

/** Paperclip button with a hidden file picker. */
export function AttachButton({
  onFiles,
  disabled,
  count,
}: {
  onFiles: (files: Array<File>) => void
  disabled?: boolean
  count: number
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
      <button
        type="button"
        disabled={disabled || count >= MAX_ATTACHMENTS}
        onClick={() => input.current?.click()}
        aria-label="Attach files"
        title="Attach images or text files (logo, photos, copy…)"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-dim transition-colors hover:bg-ink/[0.06] hover:text-ink disabled:opacity-40"
      >
        <Paperclip className="h-4 w-4" />
      </button>
    </>
  )
}

/** Attachments of the message being written. */
export function AttachmentChips({
  items,
  onRemove,
}: {
  items: Array<Attachment>
  onRemove: (key: string) => void
}) {
  if (items.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-2 px-1 pb-2" aria-label="Attached files">
      {items.map((item) => (
        <li
          key={item.key}
          title={item.error ?? item.file.name}
          className={cn(
            'relative flex h-14 max-w-[12rem] items-center gap-2 rounded-xl border bg-ink/[0.03] pr-7 pl-1.5 text-xs',
            item.status === 'error' && 'border-danger/40 text-danger',
          )}
        >
          {item.preview ? (
            <img src={item.preview} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
          ) : (
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-ink/[0.05]">
              <FileText className="h-4 w-4" aria-hidden />
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate">{item.file.name || 'Pasted image'}</span>
            <span className="block text-[10px] text-faint">
              {item.status === 'uploading'
                ? 'Uploading…'
                : item.status === 'error'
                  ? 'Failed'
                  : `${Math.max(1, Math.round(item.file.size / 1024))} KB`}
            </span>
          </span>
          {item.status === 'uploading' && (
            <Loader2
              className="absolute top-1.5 right-7 h-3 w-3 animate-spin text-signal"
              aria-hidden
            />
          )}
          <button
            type="button"
            onClick={() => onRemove(item.key)}
            aria-label={`Remove ${item.file.name || 'attachment'}`}
            className="absolute top-1/2 right-1 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-faint hover:bg-ink/[0.08] hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </li>
      ))}
    </ul>
  )
}

type UploadInfo = { id: string; storage_path: string; name: string; kind: 'image' | 'document' }
const known = new Map<string, UploadInfo>()

/** Files attached to a sent message (ids → stored files; read under RLS). */
export function MessageAttachments({ ids }: { ids: Array<string> }) {
  const [, setVersion] = useState(0)
  const key = ids.join(',')
  useEffect(() => {
    const missing = ids.filter((id) => !known.has(id))
    if (missing.length === 0) return
    void getSupabase()
      .from('agent_uploads')
      .select('id, storage_path, name, kind')
      .in('id', missing)
      .then(({ data }) => {
        for (const row of (data ?? []) as Array<UploadInfo>) known.set(row.id, row)
        setVersion((v) => v + 1)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures `ids`
  }, [key])

  if (ids.length === 0) return null
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {ids.map((id) => {
        const info = known.get(id)
        if (!info)
          return (
            <span key={id} className="h-20 w-20 animate-pulse rounded-xl border bg-ink/[0.04]" />
          )
        if (info.kind === 'image') {
          return (
            <span key={id} className="block w-24">
              <ScreenshotImage
                path={info.storage_path}
                alt={info.name}
                bucket="agent-uploads"
                className="h-20 w-24 rounded-xl border bg-white object-cover"
              />
            </span>
          )
        }
        return (
          <span
            key={id}
            className="mt-2 flex h-9 max-w-[14rem] items-center gap-2 rounded-xl border bg-ink/[0.03] px-2.5 text-xs"
          >
            <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{info.name}</span>
          </span>
        )
      })}
    </div>
  )
}
