import { useRef, useState } from 'react'
import { Globe } from 'lucide-react'
import { useDismiss } from '~/hooks/use-dismiss'

/** Publish. Not live yet: it says what's coming (one click puts the site on its own link). */
export function PublishButton() {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useDismiss(open, setOpen, root, trigger)

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex h-9 btn-sculpted items-center gap-1.5 rounded-full px-4 text-xs font-semibold md:pointer-fine:h-8"
      >
        <Globe className="h-3.5 w-3.5" aria-hidden />
        Publish
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Publish"
          className="absolute top-full right-0 z-30 mt-2 w-72 rise rounded-2xl border bg-raised p-4 shadow-xl"
        >
          <p className="flex items-center gap-2 font-display text-base font-bold">
            Publish your site
            <span className="rounded-full bg-signal/15 px-2 py-0.5 font-sans text-[11px] font-medium text-signal">
              Coming soon
            </span>
          </p>
          <p className="mt-1.5 text-xs leading-5 text-dim">
            Put your site live on the web in one click, with its own link to share.
          </p>
        </div>
      )}
    </div>
  )
}
