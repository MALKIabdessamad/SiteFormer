import { describe, expect, test } from 'bun:test'
import { applyMatches, findMatches } from '../../src/lib/server/agent/tools/text-match'

const file = `      <Button\n            className="group h-12 rounded-full px-8"\n          >\n        <figure className="order-1 m-0">\n`

function edit(oldText: string, newText: string) {
  const result = findMatches(file, oldText, false)
  if (!result.ok) return null
  return applyMatches(file, result.matches, result.newText ? result.newText(newText) : newText)
}

describe('findMatches', () => {
  test('exact match', () => {
    expect(edit('px-8"', 'px-10"')).toContain('className="group h-12 rounded-full px-10"')
  })
  test('ignores indentation differences', () => {
    expect(edit('className="group h-12 rounded-full px-8"', 'className="x"')).toContain(
      'className="x"',
    )
  })
  test('repairs className={ … } quote slips in oldText and newText', () => {
    const out = edit('className={ order-1 m-0 }', 'className={ order-2 m-0 }')
    expect(out).toContain('<figure className="order-2 m-0">')
    expect(out).not.toContain('{ ')
  })
  test('refuses text that is not there, with a hint', () => {
    const result = findMatches(file, '<figure className=order-1 m-0>', false)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.hint).toContain('Closest line 4')
  })
  test('ambiguous matches need replaceAll', () => {
    const twice = 'a\nb\na\n'
    expect(findMatches(twice, 'a', false).ok).toBe(false)
    expect(findMatches(twice, 'a', true).ok).toBe(true)
  })
})
