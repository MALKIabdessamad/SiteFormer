/**
 * Find/replace matching for edit_file. Models sometimes send oldText that differs from the file in
 * harmless ways (escaped quotes, curly vs straight quotes, indentation). Each strategy below is
 * tried in order; a fuzzy strategy is accepted only when it matches exactly ONE place, so an edit
 * never lands somewhere unintended.
 */

export type Match = { start: number; end: number; strategy: string }

export type MatchResult =
  /** `newText`: a repair to apply to the edit's newText too (same slip as in oldText). */
  | { ok: true; matches: Array<Match>; newText?: (s: string) => string }
  | { ok: false; reason: 'not_found' | 'ambiguous'; count?: number; hint?: string }

function allIndexes(haystack: string, needle: string): Array<number> {
  const out: Array<number> = []
  if (!needle) return out
  for (
    let i = haystack.indexOf(needle);
    i !== -1;
    i = haystack.indexOf(needle, i + needle.length)
  ) {
    out.push(i)
  }
  return out
}

/** Undo one level of JSON-style escaping a model sometimes leaves in tool arguments. */
const unescapeModel = (s: string) =>
  s
    .replace(/\\(["'`\\])/g, '$1')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')

/** Same-length canonical form: all quote styles → ", dashes → -, NBSP → space. */
const canonical = (s: string) =>
  s
    .replace(/["'`\u2018\u2019\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00a0/g, ' ')

/**
 * A slip seen with some models: JSX attribute quotes rewritten as braces with spaces,
 * className="a b" → className={ a b }. Prettier never writes `={ … }` with inner spaces around a
 * plain class list, so this pattern is safe to turn back into quotes (in oldText AND newText).
 */
const restoreAttributeQuotes = (s: string) => s.replace(/=\{ ([^{}\n"'`]*?) \}/g, '="$1"')

/** Line-window match ignoring leading/trailing whitespace on each line. */
function lineMatches(text: string, oldText: string): Array<Match> {
  const want = oldText
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
  while (want.length && want[0] === '') want.shift()
  while (want.length && want[want.length - 1] === '') want.pop()
  if (want.length === 0) return []
  const lines = text.split('\n')
  const offsets: Array<number> = []
  let pos = 0
  for (const line of lines) {
    offsets.push(pos)
    pos += line.length + 1
  }
  const out: Array<Match> = []
  for (let i = 0; i + want.length <= lines.length; i++) {
    let same = true
    for (let j = 0; j < want.length; j++) {
      if (lines[i + j]!.trim() !== want[j]) {
        same = false
        break
      }
    }
    if (!same) continue
    const last = i + want.length - 1
    out.push({
      start: offsets[i]!,
      end: offsets[last]! + lines[last]!.length,
      strategy: 'indentation',
    })
  }
  return out
}

/** The file line most similar to oldText's first meaningful line, to help the model retry. */
function closestLine(text: string, oldText: string): string | undefined {
  const first = oldText
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 3)
  if (!first) return undefined
  const target = canonical(first)
  const tokens = target.split(/\W+/).filter((t) => t.length > 2)
  let best: { score: number; line: string; n: number } | undefined
  text.split('\n').forEach((line, i) => {
    const c = canonical(line)
    const score = tokens.filter((t) => c.includes(t)).length
    if (score > 0 && (!best || score > best.score)) best = { score, line: line.trim(), n: i + 1 }
  })
  return best
    ? `Closest line ${best.n} (read_file lines ${Math.max(1, best.n - 3)}-${best.n + 3} and copy from there): ${best.line.slice(0, 200)}`
    : undefined
}

export function findMatches(text: string, oldText: string, replaceAll: boolean): MatchResult {
  const exact = allIndexes(text, oldText)
  if (exact.length === 1 || (exact.length > 1 && replaceAll)) {
    return {
      ok: true,
      matches: exact.map((start) => ({ start, end: start + oldText.length, strategy: 'exact' })),
    }
  }
  if (exact.length > 1) return { ok: false, reason: 'ambiguous', count: exact.length }

  // Fuzzy strategies: only a single, unambiguous match is accepted.
  const unescaped = unescapeModel(oldText)
  if (unescaped !== oldText) {
    const hits = allIndexes(text, unescaped)
    if (hits.length === 1)
      return {
        ok: true,
        matches: [{ start: hits[0]!, end: hits[0]! + unescaped.length, strategy: 'unescaped' }],
      }
  }
  for (const candidate of new Set([oldText, unescaped])) {
    const hits = allIndexes(canonical(text), canonical(candidate))
    if (hits.length === 1) {
      return {
        ok: true,
        matches: [{ start: hits[0]!, end: hits[0]! + candidate.length, strategy: 'quotes' }],
      }
    }
  }
  for (const candidate of new Set([oldText, unescaped])) {
    const hits = lineMatches(text, candidate)
    if (hits.length === 1) return { ok: true, matches: hits }
    if (hits.length > 1) return { ok: false, reason: 'ambiguous', count: hits.length }
  }
  for (const candidate of new Set([oldText, unescaped])) {
    const restored = restoreAttributeQuotes(candidate)
    if (restored === candidate) continue
    const retry = findMatches(text, restored, replaceAll)
    if (retry.ok) {
      return {
        ok: true,
        matches: retry.matches.map((m) => ({ ...m, strategy: 'attribute quotes' })),
        newText: restoreAttributeQuotes,
      }
    }
  }
  return { ok: false, reason: 'not_found', hint: closestLine(text, unescaped) }
}

/** Applies matches from last to first so earlier offsets stay valid. */
export function applyMatches(text: string, matches: Array<Match>, newText: string): string {
  let out = text
  for (const m of [...matches].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, m.start) + newText + out.slice(m.end)
  }
  return out
}
