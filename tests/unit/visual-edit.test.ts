import { expect, test } from 'bun:test'
import {
  messageLabel,
  referenceLine,
  referenceLinesOf,
  splitReferences,
} from '../../src/features/agent/lib/references'
import { fixRequest, parseBridgeEvent } from '../../src/features/projects/lib/preview-bridge'
import {
  applyTextEdits,
  EditError,
  parseLoc,
  replaceText,
} from '../../src/lib/server/visual-edit/jsx-edit'

const FILE = `import { cn } from "@/lib/utils";
export function Hero({ title }: { title: string }) {
  return (
    <main className="grid min-h-svh place-items-center">
      <h1 className="text-3xl font-semibold text-foreground">Your next project.</h1>
      <p className='mt-3 text-base md:text-lg'>
        Fish &amp; chips
      </p>
      <h2>{title}</h2>
      <span className={cn("px-2 text-sm", title && "underline")}>{"Literal"}</span>
      <img src="/hero.png" alt="" />
      <a href="/">Go</a>
    </main>
  );
}
`
const at = (line: number, column: number) => ({ file: 'src/routes/index.tsx', line, column })

test('parses element locations safely', () => {
  expect(parseLoc('src/routes/index.tsx:23:9')).toEqual(at(23, 9))
  expect(parseLoc('src/routes/posts/$id.tsx:4:5')?.file).toBe('src/routes/posts/$id.tsx')
  expect(parseLoc('../etc/passwd.tsx:1:1')).toBeNull()
  expect(parseLoc('src/a.ts:1:1')).toBeNull()
  expect(parseLoc('src/a.tsx:1')).toBeNull()
})

test('edits plain text and keeps the rest of the file byte for byte', () => {
  const out = replaceText(FILE, at(5, 7), 'Your next project.', 'Fresh bread daily')
  expect(out).toBe(FILE.replace('Your next project.', 'Fresh bread daily'))
  // Multi-line text with an entity: indentation kept, special characters quoted.
  const fish = replaceText(FILE, at(6, 7), 'Fish & chips', 'Fish & <b>chips</b>')
  expect(fish).toContain(
    '<p className=\'mt-3 text-base md:text-lg\'>\n        {"Fish & <b>chips</b>"}\n      </p>',
  )
  // A string literal child.
  expect(replaceText(FILE, at(10, 7), 'Literal', 'New')).toContain('{"New"}</span>')
})

test('refuses text that comes from code or changed meanwhile', () => {
  expect(() => replaceText(FILE, at(9, 7), 'Hello', 'Bye')).toThrow(EditError)
  expect(() => replaceText(FILE, at(5, 7), 'Something else', 'Bye')).toThrow(EditError)
  expect(() => replaceText(FILE, at(40, 1), 'x', 'y')).toThrow(EditError)
  // Right line, wrong column (the file changed): never guess.
  expect(() => replaceText(FILE, at(5, 8), 'Your next project.', 'Bye')).toThrow(EditError)
  expect(() => replaceText('const x = <div', at(1, 11), 'x', 'y')).toThrow(EditError)
})

test('a fix request carries the error once, with the page', () => {
  const text = fixRequest({
    kind: 'runtime',
    message: 'Boom',
    stack: 'Error: Boom\n    at Hero (index.tsx:3:9)',
    path: '/about',
  })
  expect(text).toBe(
    'The preview shows an error on page /about. Find the cause and fix it.\n\n```\nError: Boom\n    at Hero (index.tsx:3:9)\n```',
  )
  expect(
    fixRequest({ kind: 'build', message: 'Unexpected token', stack: '', path: '/' }),
  ).toContain('a build error on page /.')
})

test('the selected element travels as a line and comes back as a chip', () => {
  const element = { loc: 'src/routes/index.tsx:5:7', tag: 'h1', text: 'Say "hi"\n now', path: '/' }
  const line = referenceLine(element)
  expect(line).toBe('⌖ <h1> "Say ”hi” now" at src/routes/index.tsx:5:7 on /')
  const { text, refs } = splitReferences(`Make it bigger\n${line}`)
  expect(text).toBe('Make it bigger')
  expect(refs).toEqual([
    { n: null, tag: 'h1', text: 'Say ”hi” now', loc: element.loc, path: '/', note: '' },
  ])
  // Older messages numbered their lines and could carry a note; they still show.
  expect(splitReferences('⌖2 <p> "x" at src/a.tsx:1:1 on / — bigger').refs[0]).toMatchObject({
    n: 2,
    note: 'bigger',
  })
})

test('several text changes in a file: all applied, from the end backwards', () => {
  const source = `export const A = () => (
  <div>
    <h1>One</h1><p>Two</p>
    <span>{"Year " + 2026}</span>
    <p>Three</p>
  </div>
)
`
  const loc = (line: number, column: number) => ({ file: 'src/a.tsx', line, column })
  const { code, failed } = applyTextEdits(source, [
    { loc: loc(3, 5), before: 'One', after: 'First' },
    { loc: loc(3, 17), before: 'Two', after: 'Second' }, // same line, after the first
    { loc: loc(4, 5), before: 'Year 2026', after: 'Year 2030' }, // computed: can't
    { loc: loc(5, 5), before: 'Three', after: 'Third' },
  ])
  expect(code).toContain('<h1>First</h1><p>Second</p>')
  expect(code).toContain('<p>Third</p>')
  expect(code).toContain('{"Year " + 2026}')
  expect(failed.map((f) => f.edit.after)).toEqual(['Year 2030'])
})

test('bridge messages are checked before use', () => {
  const element = { loc: 'src/a.tsx:1:1', tag: 'p', text: 'Hi', path: '/' }
  expect(parseBridgeEvent({ sf: 1, type: 'pick', n: 1, element })).toEqual({
    type: 'pick',
    n: 1,
    element,
  })
  expect(parseBridgeEvent({ sf: 1, type: 'pick', n: -1, element })).toBeNull()
  expect(
    parseBridgeEvent({ sf: 1, type: 'pick', n: 1, element: { ...element, tag: 1 } }),
  ).toBeNull()
  expect(
    parseBridgeEvent({ sf: 1, type: 'viewport', scrollX: 0, scrollY: 640, path: '/a' }),
  ).toEqual({ type: 'viewport', scrollX: 0, scrollY: 640, path: '/a' })
  expect(
    parseBridgeEvent({ sf: 1, type: 'viewport', scrollX: 1.5, scrollY: 0, path: '/' }),
  ).toBeNull()
  expect(parseBridgeEvent({ sf: 2, type: 'updated' })).toBeNull()
  expect(parseBridgeEvent({ sf: 1, type: 'unknown' })).toBeNull()
})

test('an edited message keeps its element lines as they were', () => {
  const line = '⌖ <h1> "Hi" at src/routes/index.tsx:5:7 on /'
  expect(referenceLinesOf(`Make it red\n${line}\n`)).toEqual([line])
  expect(referenceLinesOf('No elements here')).toEqual([])
})

test('a message label leaves the element lines out', () => {
  const element = { loc: 'src/routes/index.tsx:4:7', tag: 'h1', text: 'Hi', path: '/' }
  const message = `Make this   bigger\nand bold\n${referenceLine(element)}`
  expect(messageLabel(message, 80)).toBe('Make this bigger and bold')
  expect(messageLabel(message, 10)).toBe('Make this…')
  expect(messageLabel(referenceLine(element), 80)).toBe('')
})
