/**
 * Text typed over an element in the preview: find the JSX element by the location the preview
 * reported (data-sf-loc="src/routes/index.tsx:23:9") and replace its text with a minimal, exact
 * string edit (the rest of the file stays byte for byte the same).
 *
 * When the code doesn't hold plain text there (it's computed in code), an EditError explains it
 * so the editor can offer the AI instead.
 */
import { parse } from '@babel/parser'

export class EditError extends Error {}

const TEXT_IN_CODE = 'This text comes from code, so it can’t be edited here. Ask the AI instead.'

export type SourceLoc = { file: string; line: number; column: number }

const LOC = /^((?:[\w.@()[\]$-]+\/)*[\w.@()[\]$-]+\.(?:tsx|jsx)):(\d{1,6}):(\d{1,5})$/

/** "src/routes/index.tsx:23:9" → { file, line, column } (1-based), or null. */
export function parseLoc(value: string): SourceLoc | null {
  const match = LOC.exec(value)
  if (!match || match[1]!.split('/').includes('..')) return null
  return { file: match[1]!, line: Number(match[2]), column: Number(match[3]) }
}

type AstNode = {
  type: string
  start: number
  end: number
  loc: { start: { line: number; column: number } }
  [key: string]: unknown
}

function walk(value: unknown, visit: (node: AstNode) => void): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit)
    return
  }
  const node = value as AstNode
  if (typeof node.type === 'string') visit(node)
  for (const key of Object.keys(node)) {
    if (key !== 'loc' && key !== 'extra') walk(node[key], visit)
  }
}

const child = (node: AstNode, key: string) => node[key] as AstNode
const children = (node: AstNode, key: string) => (node[key] as AstNode[] | undefined) ?? []

/** The JSX element written at `line:column` (1-based, as the preview reports it). */
function findElement(source: string, loc: SourceLoc): AstNode {
  let ast: unknown
  try {
    ast = parse(source, {
      sourceType: 'module',
      plugins: loc.file.endsWith('.tsx') ? ['jsx', 'typescript'] : ['jsx'],
    })
  } catch {
    throw new EditError('This file has a syntax error right now. Fix it (or ask the AI) first.')
  }
  const onLine: AstNode[] = []
  walk(ast, (node) => {
    if (node.type === 'JSXElement' && child(node, 'openingElement').loc.start.line === loc.line) {
      onLine.push(node)
    }
  })
  // Exact position only: if the file changed since the page was rendered, a near match could be
  // a different element.
  const found = onLine.find(
    (node) => child(node, 'openingElement').loc.start.column + 1 === loc.column,
  )
  if (!found) {
    throw new EditError('This element moved in the code. Reload the preview and try again.')
  }
  return found
}

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()

const splice = (source: string, node: { start: number; end: number }, text: string) =>
  source.slice(0, node.start) + text + source.slice(node.end)

/** JSX text that renders `text` as is (characters JSX treats specially go in a string). */
function jsxText(text: string): string {
  return /[{}<>&]/.test(text) ? `{${JSON.stringify(text)}}` : text
}

/** Changes an element's text (a single plain text child) from `before` to `after`. */
export function replaceText(source: string, loc: SourceLoc, before: string, after: string): string {
  const element = findElement(source, loc)
  const kids = children(element, 'children').filter(
    (kid) => !(kid.type === 'JSXText' && /^\s*$/.test(String(kid['value']))),
  )
  const kid = kids.length === 1 ? kids[0]! : null
  if (kid?.type === 'JSXText' && normalize(String(kid['value'])) === normalize(before)) {
    const raw = source.slice(kid.start, kid.end)
    const lead = /^\s*/.exec(raw)![0]
    const trail = /\s*$/.exec(raw)![0]
    return splice(source, kid, `${lead}${jsxText(after)}${trail}`)
  }
  if (kid?.type === 'JSXExpressionContainer') {
    const expression = child(kid, 'expression')
    const literal =
      expression.type === 'StringLiteral'
        ? String(expression['value'])
        : expression.type === 'TemplateLiteral' && children(expression, 'expressions').length === 0
          ? String((children(expression, 'quasis')[0]?.['value'] as { cooked?: string })?.cooked)
          : null
    if (literal !== null && normalize(literal) === normalize(before)) {
      return splice(source, expression, JSON.stringify(after))
    }
  }
  throw new EditError(TEXT_IN_CODE)
}
