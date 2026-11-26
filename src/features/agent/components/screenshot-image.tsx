import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, ImageOff, X } from 'lucide-react'
import { reportClientError } from '~/lib/report-error'
import { getSupabase } from '~/lib/supabase/client'
import { cn } from '~/lib/utils/cn'

const SCREENSHOTS = 'agent-screenshots'
/** Signed URLs live 1 hour; cache them so re-renders don't re-sign. */
const cache = new Map<string, { url: string; expires: number }>() // key: bucket/path

/**
 * A small thumbnail of an image from a private bucket (screenshots, generated images, uploads)
 * that opens full size on click. Only the project owner can read it (Storage RLS), through a
 * short-lived signed URL.
 */
export function ScreenshotImage({
  path,
  alt,
  bucket = SCREENSHOTS,
  className = 'h-14 w-20',
}: {
  path: string
  alt: string
  bucket?: string
  /** Thumbnail size. */
  className?: string
}) {
  const [url, setUrl] = useState<string | null>(() => {
    const hit = cache.get(`${bucket}/${path}`)
    return hit && hit.expires > Date.now() ? hit.url : null
  })
  const [failed, setFailed] = useState<false | 'expired' | 'error'>(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (url) return
    let live = true
    void getSupabase()
      .storage.from(bucket)
      .createSignedUrl(path, 3600)
      .then(({ data, error }) => {
        if (!live) return
        if (error || !data) {
          // Screenshots of older runs are cleared to save storage: not an error.
          if (/not found/i.test(error?.message ?? '')) return setFailed('expired')
          reportClientError('screenshot', 'Could not sign screenshot URL', {
            detail: `${path}: ${error?.message ?? 'no data'}`,
            projectId: path.split('/')[0],
          })
          return setFailed('error')
        }
        cache.set(`${bucket}/${path}`, {
          url: data.signedUrl,
          expires: Date.now() + 55 * 60 * 1000,
        })
        setUrl(data.signedUrl)
      })
    return () => {
      live = false
    }
  }, [bucket, path, url])

  const box = cn('block shrink-0 overflow-hidden rounded-lg border bg-ink/[0.04]', className)

  if (failed) {
    return (
      <span
        className={cn(box, 'grid place-items-center text-faint')}
        title={failed === 'expired' ? 'Older image (cleared)' : 'Image unavailable'}
      >
        <ImageOff
          className="h-4 w-4"
          aria-label={failed === 'expired' ? 'Older image (cleared)' : 'Image unavailable'}
        />
      </span>
    )
  }
  return (
    <>
      <button
        type="button"
        onClick={() => url && setOpen(true)}
        disabled={!url}
        aria-label={`Open ${alt}`}
        title={alt}
        className={cn(
          box,
          'transition-[transform,border-color] hover:border-signal/60 active:scale-[0.97]',
          !url && 'animate-pulse',
        )}
      >
        {url && (
          <img
            src={url}
            alt={alt}
            loading="lazy"
            onError={() => {
              reportClientError('screenshot', 'Screenshot image failed to load', {
                detail: path,
                projectId: path.split('/')[0],
              })
              setFailed('error')
            }}
            className="h-full w-full bg-white object-cover object-top"
          />
        )}
      </button>
      {open && url && <Lightbox url={url} alt={alt} onClose={() => setOpen(false)} />}
    </>
  )
}

/** Full-size view over the page. Esc, the close button or a click outside closes it. */
function Lightbox({ url, alt, onClose }: { url: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      className="fixed inset-0 z-[100] grid place-items-center bg-black/80 p-4 backdrop-blur-sm"
    >
      <div className="absolute top-3 right-3 flex gap-2">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          aria-label="Open in a new tab"
          className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
        <button
          type="button"
          autoFocus
          onClick={onClose}
          aria-label="Close"
          className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <img
        src={url}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88vh] max-w-full rounded-xl bg-white object-contain shadow-2xl"
      />
    </div>,
    document.body,
  )
}
