/**
 * Direct edits from the visual editor: find a JSX element by the location the preview reported
 * (data-sf-loc="src/routes/index.tsx:23:9") and change its text, classes or image source with
 * minimal, exact string edits (the rest of the file stays byte for byte the same).
 *
 * When the code doesn't hold a plain value to change (text or classes computed in code), an
 * EditError explains it so the editor can offer the AI instead.
 */
import { parse } from '@babel/parser'

export class EditError extends Error {}

const TEXT_IN_CODE = 'This text comes from code, so it can’t be edited here. Ask the AI instead.'
const STYLE_IN_CODE =
  'This element’s style is set in code, so it can’t be changed here. Ask the AI instead.'
const IMAGE_IN_CODE = 'This image is set in code, so it can’t be swapped here. Ask the AI instead.'

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
  const column = (node: AstNode) => child(node, 'openingElement').loc.start.column + 1
  const found =
    onLine.find((node) => column(node) === loc.column) ??
    (onLine.length === 1 ? onLine[0] : undefined)
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

function attribute(element: AstNode, names: string[]): AstNode | undefined {
  return children(child(element, 'openingElement'), 'attributes').find(
    (attr) =>
      attr.type === 'JSXAttribute' && names.includes(String(child(attr, 'name')['name'] ?? '')),
  )
}

const CLASS_HELPERS = new Set(['cn', 'clsx', 'cx', 'classNames', 'twMerge'])

/** Rewrites an element's class list with `update` (a plain className, or cn("…", …)'s first string). */
export function replaceClasses(
  source: string,
  loc: SourceLoc,
  update: (classes: string) => string,
): string {
  const element = findElement(source, loc)
  const attr = attribute(element, ['className', 'class'])
  if (!attr) {
    const next = update('')
    if (!next) return source
    const name = child(child(element, 'openingElement'), 'name')
    return source.slice(0, name.end) + ` className="${next}"` + source.slice(name.end)
  }
  const value = attr['value'] as AstNode | null
  if (value?.type === 'StringLiteral') {
    const quote = source[value.start] === "'" ? "'" : '"'
    const next = update(String(value['value']))
    if (next.includes(quote)) return splice(source, value, `{${JSON.stringify(next)}}`)
    return splice(source, value, `${quote}${next}${quote}`)
  }
  if (value?.type === 'JSXExpressionContainer') {
    const expression = child(value, 'expression')
    if (expression.type === 'StringLiteral') {
      return splice(source, expression, JSON.stringify(update(String(expression['value']))))
    }
    if (expression.type === 'TemplateLiteral' && children(expression, 'expressions').length === 0) {
      const raw = String((children(expression, 'quasis')[0]?.['value'] as { raw?: string })?.raw)
      return splice(source, expression, `\`${update(raw).replace(/[`$\\]/g, '\\$&')}\``)
    }
    const callee = expression.type === 'CallExpression' ? child(expression, 'callee') : null
    const first = expression.type === 'CallExpression' ? children(expression, 'arguments')[0] : null
    if (
      callee?.type === 'Identifier' &&
      CLASS_HELPERS.has(String(callee['name'])) &&
      first?.type === 'StringLiteral'
    ) {
      return splice(source, first, JSON.stringify(update(String(first['value']))))
    }
  }
  throw new EditError(STYLE_IN_CODE)
}

/** Points an image at a new `src` (a plain string in the code). */
export function replaceImageSrc(source: string, loc: SourceLoc, src: string): string {
  const element = findElement(source, loc)
  const attr = attribute(element, ['src'])
  const value = attr?.['value'] as AstNode | null | undefined
  if (value?.type === 'StringLiteral') return splice(source, value, JSON.stringify(src))
  if (value?.type === 'JSXExpressionContainer') {
    const expression = child(value, 'expression')
    if (expression.type === 'StringLiteral') return splice(source, expression, JSON.stringify(src))
  }
  throw new EditError(IMAGE_IN_CODE)
}
