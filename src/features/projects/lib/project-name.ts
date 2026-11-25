/**
 * Project names come from an AI model that read the user's (untrusted) prompt, so every name is
 * cleaned before it is stored: plain text, short, never empty.
 */

export const MAX_NAME_LENGTH = 48
export const FALLBACK_NAME = 'New site'

function sanitize(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/<[^>]*>/g, ' ') // HTML-like tags
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, ' ') // control / invisible characters
    .replace(/[<>`"\\{}[\]|^~*_#]/g, '') // markdown and markup symbols
    .replace(/^(project|site|website)\s*(name)?\s*[:\-–]\s*/i, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,;:!?'’-]+|[\s.,;:!?'’-]+$/g, '')
}

function clip(value: string): string {
  if (value.length <= MAX_NAME_LENGTH) return value
  const cut = value.slice(0, MAX_NAME_LENGTH)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim()
}

const STOP_WORDS = new Set(
  'a an the my me our for to of and with in on build make create please i we want need website site page web app landing'.split(
    ' ',
  ),
)

/** A readable name taken straight from the prompt (used until/unless the AI names it). */
export function nameFromPrompt(prompt: string): string {
  const words = sanitize(prompt.slice(0, 600))
    .split(' ')
    .filter((w) => w && !STOP_WORDS.has(w.toLowerCase()))
    .slice(0, 4)
  const name = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  return name.length >= 2 ? clip(name) : FALLBACK_NAME
}

/** The model's suggestion when usable, otherwise a name derived from the prompt. */
export function finalProjectName(suggestion: string | undefined, prompt: string): string {
  const cleaned = suggestion ? clip(sanitize(suggestion)) : ''
  return cleaned.length >= 2 ? cleaned : nameFromPrompt(prompt)
}
