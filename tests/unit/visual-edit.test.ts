import { expect, test } from 'bun:test'
import { hexToOklch, oklchToHex } from '../../src/features/projects/lib/colors'
import { currentStyle, setStyle } from '../../src/features/projects/lib/tailwind-classes'
import { readRootVars, writeRootVars } from '../../src/features/projects/lib/theme-css'
import {
  EditError,
  parseLoc,
  replaceClasses,
  replaceImageSrc,
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
  expect(() => replaceText('const x = <div', at(1, 11), 'x', 'y')).toThrow(EditError)
})

test('changes classes: plain strings, single quotes, cn() and a missing className', () => {
  const bigger = (classes: string) => setStyle(classes, 'fontSize', 'text-5xl')
  expect(replaceClasses(FILE, at(5, 7), bigger)).toContain(
    '<h1 className="text-5xl font-semibold text-foreground">',
  )
  // Responsive size dropped so the new size shows everywhere; quote style kept.
  expect(replaceClasses(FILE, at(6, 7), bigger)).toContain("<p className='mt-3 text-5xl'>")
  expect(replaceClasses(FILE, at(10, 7), bigger)).toContain(
    '<span className={cn("px-2 text-5xl", title && "underline")}>',
  )
  expect(
    replaceClasses(FILE, at(12, 7), (c) => setStyle(c, 'textColor', 'text-primary')),
  ).toContain('<a className="text-primary" href="/">Go</a>')
  expect(() =>
    replaceClasses('const x = <div className={styles.box} />', at(1, 11), bigger),
  ).toThrow(EditError)
})

test('swaps an image source', () => {
  expect(replaceImageSrc(FILE, at(11, 7), '/uploads/new.png')).toContain(
    '<img src="/uploads/new.png" alt="" />',
  )
  expect(() => replaceImageSrc('const x = <img src={hero} />', at(1, 11), '/a.png')).toThrow(
    EditError,
  )
})

test('tailwind groups: one value, state variants kept', () => {
  expect(setStyle('text-sm md:text-lg hover:text-xl font-bold', 'fontSize', 'text-2xl')).toBe(
    'text-2xl hover:text-xl font-bold',
  )
  expect(setStyle('text-foreground text-sm', 'textColor', 'text-red-500')).toBe(
    'text-red-500 text-sm',
  )
  expect(setStyle('px-4 py-2 rounded', 'padding', 'p-6')).toBe('p-6 rounded')
  expect(setStyle('rounded-lg shadow', 'borderRadius', null)).toBe('shadow')
  expect(setStyle('', 'textAlign', 'text-center')).toBe('text-center')
  expect(currentStyle('text-left md:text-3xl text-xl', 'fontSize')).toBe('text-xl')
  expect(currentStyle('text-left', 'fontSize')).toBeNull()
  expect(() => setStyle('', 'fontSize', 'text-red-500')).toThrow()
})

test('colors round-trip between hex and oklch', () => {
  expect(hexToOklch('#ffffff')).toBe('oklch(1 0 0)')
  expect(hexToOklch('#000000')).toBe('oklch(0 0 0)')
  expect(hexToOklch('#3b82f6')).toBe('oklch(0.623 0.188 259.8)')
  for (const hex of ['#3b82f6', '#e11d48', '#10b981', '#fafaf9']) {
    expect(oklchToHex(hexToOklch(hex))).toBe(hex)
  }
  expect(oklchToHex('oklch(62.3% 0.188 259.8deg / 50%)')).toBe('#3b82f6')
  expect(oklchToHex('#fff')).toBeNull()
})

test('theme variables: read and write only :root', () => {
  const css = `/* :root and .dark blocks */\n:root {\n  --radius: 0.5rem;\n  --primary: oklch(0.25 0 0);\n}\n.dark {\n  --primary: oklch(0.9 0 0);\n}\n`
  expect(readRootVars(css)).toEqual({ radius: '0.5rem', primary: 'oklch(0.25 0 0)' })
  const out = writeRootVars(css, { primary: 'oklch(0.6 0.2 260)', radius: '1rem', missing: 'x' })
  expect(out).toContain(':root {\n  --radius: 1rem;\n  --primary: oklch(0.6 0.2 260);\n}')
  expect(out).toContain('.dark {\n  --primary: oklch(0.9 0 0);')
  expect(() => writeRootVars(css, { primary: 'red; } body {' })).toThrow()
})
