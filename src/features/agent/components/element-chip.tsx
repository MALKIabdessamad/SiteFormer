import {
  CircleDashed,
  Image,
  Link as LinkIcon,
  MousePointerClick,
  RectangleHorizontal,
  Type,
  X,
} from 'lucide-react'
import { cn } from '~/lib/utils/cn'

const TEXT = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'span',
  'strong',
  'em',
  'b',
  'i',
  'small',
  'label',
  'li',
  'blockquote',
  'figcaption',
  'text',
])
const MEDIA = new Set(['img', 'picture', 'svg', 'video', 'canvas'])
const FIELDS = new Set(['input', 'textarea', 'select'])

/** The element's kind at a glance: text, media, a field, a link, a button or a box. */
function KindIcon({ tag, className }: { tag: string; className: string }) {
  if (TEXT.has(tag)) return <Type className={className} aria-hidden />
  if (MEDIA.has(tag)) return <Image className={className} aria-hidden />
  if (FIELDS.has(tag)) return <RectangleHorizontal className={className} aria-hidden />
  if (tag === 'a') return <LinkIcon className={className} aria-hidden />
  if (tag === 'button') return <MousePointerClick className={className} aria-hidden />
  return <CircleDashed className={className} aria-hidden />
}

const chip =
  'inline-flex h-6 max-w-full shrink-0 items-center gap-1 rounded-md border border-signal/30 bg-signal/15 px-1.5 text-xs font-medium text-signal'

/**
 * An element picked in the preview, as a small blue chip: its kind and tag (`title` has the
 * details). With `onRemove`, pressing it takes the element out of the message.
 */
export function ElementChip({
  tag,
  title,
  onRemove,
}: {
  tag: string
  title?: string
  onRemove?: () => void
}) {
  if (!onRemove) {
    return (
      <span className={chip} title={title}>
        <KindIcon tag={tag} className="h-3.5 w-3.5 shrink-0" />
        {tag}
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={onRemove}
      title={title}
      aria-label={`Remove the selected <${tag}> element`}
      className={cn(chip, 'group transition-colors hover:bg-signal/25')}
    >
      <KindIcon tag={tag} className="h-3.5 w-3.5 shrink-0 group-hover:hidden" />
      <X className="hidden h-3.5 w-3.5 shrink-0 group-hover:block" aria-hidden />
      {tag}
    </button>
  )
}
