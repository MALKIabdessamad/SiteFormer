import { expect, test } from 'bun:test'
import { buildTree, defaultFile, foldersOf } from '../../src/features/projects/lib/file-tree'

test('folders first, sorted', () => {
  const tree = buildTree(['b.ts', 'src/routes/index.tsx', 'a.ts', 'src/app.tsx'])
  expect(tree.map((n) => n.name)).toEqual(['src', 'a.ts', 'b.ts'])
  const src = tree[0]!
  expect(src.kind === 'dir' && src.children.map((n) => n.name)).toEqual(['routes', 'app.tsx'])
})

test('opens the home page first', () => {
  expect(defaultFile(['package.json', 'src/routes/index.tsx'])).toBe('src/routes/index.tsx')
  expect(defaultFile([])).toBeNull()
  expect([...foldersOf('src/routes/index.tsx')]).toEqual(['src', 'src/routes'])
})
