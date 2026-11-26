/**
 * Tailwind class groups the visual editor can change on an element: one value per group, set on
 * the base (unprefixed) class. Responsive variants of the same group are dropped so the new value
 * shows on every screen size; state variants (hover:, dark:, focus:…) are kept.
 */

const PALETTE = [
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
].join('|')
// The starter's theme colors (src/styles.css @theme).
const TOKENS =
  'background|foreground|card|card-foreground|popover|popover-foreground|primary|primary-foreground|secondary|secondary-foreground|muted|muted-foreground|accent|accent-foreground|destructive|destructive-foreground|border|input|ring'
const COLOR = `(?:inherit|current|transparent|black|white|(?:${PALETTE})-(?:50|[1-9]00|950)|${TOKENS}|\\[(?:#|rgb|hsl|oklch|color|var)[^\\]]*\\])(?:/\\d{1,3})?`

const GROUPS = {
  textColor: new RegExp(`^text-${COLOR}$`),
  backgroundColor: new RegExp(`^bg-${COLOR}$`),
  fontSize: /^text-(?:xs|sm|base|lg|xl|[2-9]xl|\[\d+(?:\.\d+)?(?:px|rem|em)\])$/,
  fontWeight: /^font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/,
  textAlign: /^text-(?:left|center|right|justify|start|end)$/,
  borderRadius: /^rounded(?:-(?:none|xs|sm|md|lg|xl|2xl|3xl|4xl|full))?$/,
  padding: /^p[xytrblse]?-(?:\d+(?:\.5)?|px|\[[^\]]+\])$/,
} as const

export type StyleGroup = keyof typeof GROUPS
export const STYLE_GROUPS = Object.keys(GROUPS) as StyleGroup[]

/** Values the editor offers for each group (all valid classes). */
export const STYLE_OPTIONS: Record<StyleGroup, string[]> = {
  textColor: [
    'text-foreground',
    'text-muted-foreground',
    'text-primary',
    'text-white',
    'text-black',
    'text-slate-500',
    'text-red-500',
    'text-orange-500',
    'text-amber-500',
    'text-green-600',
    'text-emerald-500',
    'text-teal-500',
    'text-sky-500',
    'text-blue-600',
    'text-indigo-500',
    'text-violet-500',
    'text-purple-500',
    'text-pink-500',
    'text-rose-500',
  ],
  backgroundColor: [
    'bg-background',
    'bg-muted',
    'bg-primary',
    'bg-transparent',
    'bg-white',
    'bg-black',
    'bg-slate-100',
    'bg-slate-900',
    'bg-red-500',
    'bg-orange-500',
    'bg-amber-400',
    'bg-green-600',
    'bg-emerald-500',
    'bg-teal-500',
    'bg-sky-500',
    'bg-blue-600',
    'bg-indigo-500',
    'bg-violet-500',
    'bg-pink-500',
  ],
  fontSize: [
    'text-xs',
    'text-sm',
    'text-base',
    'text-lg',
    'text-xl',
    'text-2xl',
    'text-3xl',
    'text-4xl',
    'text-5xl',
    'text-6xl',
    'text-7xl',
  ],
  fontWeight: [
    'font-light',
    'font-normal',
    'font-medium',
    'font-semibold',
    'font-bold',
    'font-extrabold',
    'font-black',
  ],
  textAlign: ['text-left', 'text-center', 'text-right'],
  borderRadius: [
    'rounded-none',
    'rounded-sm',
    'rounded-md',
    'rounded-lg',
    'rounded-xl',
    'rounded-2xl',
    'rounded-3xl',
    'rounded-full',
  ],
  padding: ['p-0', 'p-1', 'p-2', 'p-3', 'p-4', 'p-6', 'p-8', 'p-10', 'p-12', 'p-16'],
}

const RESPONSIVE = /^(?:(?:sm|md|lg|xl|2xl|max-sm|max-md|max-lg|max-xl|max-2xl):)+$/

function split(cls: string): { variants: string; base: string } {
  const at = cls.lastIndexOf(':')
  return at === -1
    ? { variants: '', base: cls }
    : { variants: cls.slice(0, at + 1), base: cls.slice(at + 1) }
}

/** Whether `value` is one of the classes the editor may set for `group`. */
export const isStyleValue = (group: StyleGroup, value: string) => GROUPS[group].test(value)

/** The group's current base value in a class list, if any. */
export function currentStyle(classes: string, group: StyleGroup): string | null {
  for (const cls of classes.split(/\s+/)) {
    const { variants, base } = split(cls)
    if (!variants && GROUPS[group].test(base)) return base
  }
  return null
}

/** The class list with `group` set to `value` (or removed when `value` is null). */
export function setStyle(classes: string, group: StyleGroup, value: string | null): string {
  if (value !== null && !isStyleValue(group, value)) throw new Error(`Not a ${group} class`)
  const out: string[] = []
  let placed = false
  for (const cls of classes.split(/\s+/).filter(Boolean)) {
    const { variants, base } = split(cls)
    const inGroup = GROUPS[group].test(base) && (!variants || RESPONSIVE.test(variants))
    if (!inGroup) {
      out.push(cls)
    } else if (!placed && value !== null) {
      out.push(value)
      placed = true
    }
  }
  if (!placed && value !== null) out.push(value)
  return out.join(' ')
}
