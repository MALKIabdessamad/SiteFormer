import { Fragment, type ReactNode } from 'react'

/**
 * Minimal, safe Markdown for agent replies: headings, lists, fenced code, paragraphs, **bold**,
 * *italic*, `code` and http(s) links. Builds React elements only (no HTML injection possible).
 */
export function Markdown({ text }: { text: string }) {
  return <div className="space-y-2.5 text-sm leading-relaxed break-words">{blocks(text)}</div>
}

function blocks(text: string): Array<ReactNode> {
  const out: Array<ReactNode> = []
  const lines = text.replace(/\r/g, '').split('\n')
  let i = 0
  let key = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (line.startsWith('```')) {
      const code: Array<string> = []
      i += 1
      while (i < lines.length && !lines[i]!.startsWith('```')) code.push(lines[i++]!)
      i += 1
      out.push(
        <pre
          key={key++}
          className="overflow-x-auto rounded-xl border bg-ink/[0.04] p-3 font-mono text-xs leading-relaxed"
        >
          {code.join('\n')}
        </pre>,
      )
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      out.push(
        <p key={key++} className="font-display font-bold tracking-tight text-ink">
          {inline(heading[2]!)}
        </p>,
      )
      i += 1
      continue
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line)
      const items: Array<string> = []
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*([-*]|\d+\.)\s+/, ''))
        i += 1
      }
      const List = ordered ? 'ol' : 'ul'
      out.push(
        <List
          key={key++}
          className={`space-y-1 pl-5 ${ordered ? 'list-decimal' : 'list-disc'} marker:text-faint`}
        >
          {items.map((item, n) => (
            <li key={n}>{inline(item)}</li>
          ))}
        </List>,
      )
      continue
    }
    if (line.trim() === '') {
      i += 1
      continue
    }
    const para: Array<string> = []
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !lines[i]!.startsWith('```') &&
      !/^(#{1,4})\s/.test(lines[i]!) &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i]!)
    ) {
      para.push(lines[i++]!)
    }
    out.push(<p key={key++}>{inline(para.join('\n'))}</p>)
  }
  return out
}

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g

function inline(text: string): ReactNode {
  const parts = text.split(INLINE)
  return parts.map((part, i) => {
    if (!part) return null
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={i} className="rounded-md bg-ink/[0.07] px-1.5 py-0.5 font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      )
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2)
      return <em key={i}>{part.slice(1, -1)}</em>
    const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(part)
    if (link) {
      return (
        <a
          key={i}
          href={link[2]}
          target="_blank"
          rel="noreferrer noopener"
          className="text-signal underline underline-offset-2"
        >
          {link[1]}
        </a>
      )
    }
    return <Fragment key={i}>{part}</Fragment>
  })
}
