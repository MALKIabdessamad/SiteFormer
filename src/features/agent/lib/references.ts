/**
 * Elements picked in the preview travel in the message as one line each, which the AI reads and
 * the chat shows as a chip:  ⌖2 <h1> "Your next project." at src/routes/index.tsx:23:9 on / — make it bigger
 */

export type ElementRef = { loc: string; tag: string; text: string; path: string }

export type ParsedReference = ElementRef & { n: number | null; note: string }

const LINE = /^⌖(\d*) <([a-z][a-z0-9-]*)> "([^"]*)" at (\S+) on (\S+)(?: — (.+))?$/

const excerpt = (text: string) => {
  const flat = text.replace(/\s+/g, ' ').replace(/"/g, '”').trim()
  return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat
}

/** One line for the message (`n` numbers annotation pins; `note` is what to do there). */
export function referenceLine(
  element: ElementRef,
  { n, note }: { n?: number; note?: string } = {},
): string {
  const path = element.path.replace(/\s/g, '%20') || '/'
  const tail = note?.trim() ? ` — ${note.replace(/\s+/g, ' ').trim()}` : ''
  return `⌖${n ?? ''} <${element.tag}> "${excerpt(element.text)}" at ${element.loc} on ${path}${tail}`
}

/** A message's own text and the elements it points at. */
export function splitReferences(message: string): { text: string; refs: Array<ParsedReference> } {
  const refs: Array<ParsedReference> = []
  const text: Array<string> = []
  for (const line of message.split('\n')) {
    const match = LINE.exec(line.trim())
    if (match) {
      refs.push({
        n: match[1] ? Number(match[1]) : null,
        tag: match[2]!,
        text: match[3]!,
        loc: match[4]!,
        path: match[5]!,
        note: match[6] ?? '',
      })
    } else text.push(line)
  }
  return { text: text.join('\n').trim(), refs }
}
