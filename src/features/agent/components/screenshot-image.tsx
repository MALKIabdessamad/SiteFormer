import { useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { reportClientError } from '~/lib/report-error'
import { getSupabase } from '~/lib/supabase/client'

const BUCKET = 'agent-screenshots'
/** Signed URLs live 1 hour; cache them so re-renders don't re-sign. */
const cache = new Map<string, { url: string; expires: number }>()

/** A screenshot the agent took, from the private bucket (only the project owner can read it). */
export function ScreenshotImage({ path, alt }: { path: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(() => {
    const hit = cache.get(path)
    return hit && hit.expires > Date.now() ? hit.url : null
  })
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (url) return
    let live = true
    void getSupabase()
      .storage.from(BUCKET)
      .createSignedUrl(path, 3600)
      .then(({ data, error }) => {
        if (!live) return
        if (error || !data) {
          reportClientError('screenshot', 'Could not sign screenshot URL', {
            detail: `${path}: ${error?.message ?? 'no data'}`,
            projectId: path.split('/')[0],
          })
          return setFailed(true)
        }
        cache.set(path, { url: data.signedUrl, expires: Date.now() + 55 * 60 * 1000 })
        setUrl(data.signedUrl)
      })
    return () => {
      live = false
    }
  }, [path, url])

  if (failed) {
    return (
      <div className="mt-2 flex h-24 items-center justify-center gap-2 rounded-xl border text-xs text-faint">
        <ImageOff className="h-4 w-4" aria-hidden /> Screenshot unavailable
      </div>
    )
  }
  return (
    <a href={url ?? undefined} target="_blank" rel="noreferrer" className="mt-2 block">
      {url ? (
        <img
          src={url}
          alt={alt}
          onError={() => {
            reportClientError('screenshot', 'Screenshot image failed to load', {
              detail: path,
              projectId: path.split('/')[0],
            })
            setFailed(true)
          }}
          loading="lazy"
          className="max-h-72 w-full rounded-xl border bg-white object-cover object-top"
        />
      ) : (
        <div className="h-40 animate-pulse rounded-xl border bg-ink/[0.04]" />
      )}
    </a>
  )
}
