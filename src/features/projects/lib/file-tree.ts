export type TreeNode =
  | { kind: 'file'; name: string; path: string }
  | { kind: 'dir'; name: string; path: string; children: Array<TreeNode> }

/** Builds a sorted tree (folders first) from flat "a/b/c.ts" paths. */
export function buildTree(paths: ReadonlyArray<string>): Array<TreeNode> {
  const root: Array<TreeNode> = []
  for (const path of paths) {
    const parts = path.split('/')
    let level = root
    parts.forEach((name, i) => {
      const at = parts.slice(0, i + 1).join('/')
      if (i === parts.length - 1) {
        level.push({ kind: 'file', name, path: at })
        return
      }
      let dir = level.find(
        (n): n is Extract<TreeNode, { kind: 'dir' }> => n.kind === 'dir' && n.name === name,
      )
      if (!dir) {
        dir = { kind: 'dir', name, path: at, children: [] }
        level.push(dir)
      }
      level = dir.children
    })
  }
  const sort = (nodes: Array<TreeNode>) => {
    nodes.sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1,
    )
    for (const n of nodes) if (n.kind === 'dir') sort(n.children)
  }
  sort(root)
  return root
}

/** The file to open first: the home page if there is one. */
export function defaultFile(paths: ReadonlyArray<string>): string | null {
  const preferred = ['src/routes/index.tsx', 'src/App.tsx', 'index.html', 'src/main.tsx']
  return (
    preferred.find((p) => paths.includes(p)) ??
    paths.find((p) => p.startsWith('src/')) ??
    paths[0] ??
    null
  )
}

/** Folders open at first: the ones leading to `file`. */
export function foldersOf(file: string | null): Set<string> {
  const out = new Set<string>()
  if (!file) return out
  const parts = file.split('/')
  for (let i = 1; i < parts.length; i++) out.add(parts.slice(0, i).join('/'))
  return out
}
