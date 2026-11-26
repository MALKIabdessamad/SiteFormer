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
    <ul className="flex flex-wrap gap-1.5 px-1 pb-2" aria-label="Attached files">
      {items.map((item) => (
        <li
          key={item.key}
          title={item.error ?? item.file.name}
          className={cn(
            'group relative flex h-10 max-w-[11rem] items-center gap-2 rounded-xl border bg-ink/[0.03] pr-7 pl-1 text-xs',
            item.status === 'error' && 'border-danger/40 text-danger',
          )}
        >
          <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-ink/[0.05]">
            {item.preview ? (
              <img src={item.preview} alt="" className="h-full w-full object-cover" />
            ) : (
              <FileText className="absolute inset-0 m-auto h-3.5 w-3.5" aria-hidden />
            )}
            {item.status === 'uploading' && (
              <span className="absolute inset-0 grid place-items-center bg-black/45">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-white" aria-label="Uploading" />
              </span>
            )}
          </span>
          <span className="min-w-0">
            <span className="block truncate leading-tight">{item.file.name || 'Pasted image'}</span>
            <span className="block text-[10px] leading-tight text-faint">
              {item.status === 'uploading'
                ? 'Uploading…'
                : item.status === 'error'
                  ? 'Failed'
                  : `${Math.max(1, Math.round(item.file.size / 1024))} KB`}
            </span>
          </span>
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
    <div className="flex flex-wrap justify-end gap-1.5">
      {ids.map((id) => {
        const info = known.get(id)
        if (!info)
          return (
            <span key={id} className="h-12 w-12 animate-pulse rounded-lg border bg-ink/[0.04]" />
          )
        if (info.kind === 'image') {
          return (
            <ScreenshotImage
              key={id}
              path={info.storage_path}
              alt={info.name}
              bucket="agent-uploads"
              className="h-12 w-12"
            />
          )
        }
        return (
          <span
            key={id}
            title={info.name}
            className="flex h-12 max-w-[11rem] items-center gap-2 rounded-lg border bg-ink/[0.03] px-2.5 text-xs"
          >
            <FileText className="h-3.5 w-3.5 shrink-0 text-dim" aria-hidden />
            <span className="truncate">{info.name}</span>
          </span>
        )
      })}
    </div>
  )
}
