/** The site's theme: custom properties in the `:root` block of src/styles.css. */

export const THEME_FILE = 'src/styles.css'

/** Colors the theme editor shows, in order. */
export const THEME_COLORS = [
  { token: 'background', label: 'Background' },
  { token: 'foreground', label: 'Text' },
  { token: 'primary', label: 'Primary' },
  { token: 'primary-foreground', label: 'Text on primary' },
  { token: 'secondary', label: 'Secondary' },
  { token: 'accent', label: 'Accent' },
  { token: 'muted', label: 'Muted' },
  { token: 'muted-foreground', label: 'Muted text' },
  { token: 'border', label: 'Borders' },
] as const

export const RADIUS = /^(?:0|\d(?:\.\d{1,3})?rem)$/

function rootBlock(css: string): { start: number; end: number } | null {
  const open = /:root\s*\{/.exec(css)
  if (!open) return null
  const start = open.index + open[0].length
  const end = css.indexOf('}', start)
  return end === -1 ? null : { start, end }
}

const declaration = (name: string) => new RegExp(`(--${name}\\s*:\\s*)([^;]+)(;)`)

/** The `:root` custom properties (name without "--" → value), or null when there is no block. */
export function readRootVars(css: string): Record<string, string> | null {
  const block = rootBlock(css)
  if (!block) return null
  const vars: Record<string, string> = {}
  for (const match of css.slice(block.start, block.end).matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    vars[match[1]!] = match[2]!.trim()
  }
  return vars
}

/** The stylesheet with existing `:root` properties set to new values (others are left alone). */
export function writeRootVars(css: string, values: Record<string, string>): string {
  const block = rootBlock(css)
  if (!block) throw new Error('No :root block')
  let body = css.slice(block.start, block.end)
  for (const [name, value] of Object.entries(values)) {
    if (!/^[\w-]+$/.test(name) || /[;{}]/.test(value)) throw new Error('Invalid theme value')
    body = body.replace(declaration(name), (_all, head: string, _old: string, tail: string) => {
      return `${head}${value}${tail}`
    })
  }
  return css.slice(0, block.start) + body + css.slice(block.end)
}
