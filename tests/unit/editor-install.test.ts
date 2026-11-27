import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import bridge from '../../src/lib/server/sandbox/editor/bridge.js.txt?raw'
import { EDITOR_VERSION, editorInstallScript } from '../../src/lib/server/sandbox/editor/install'
import plugin from '../../src/lib/server/sandbox/editor/vite-plugin.ts.txt?raw'

const CONFIG = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(() => ({
  plugins: [
    react(),
  ],
}));
`

const run = (dir: string) => {
  const result = Bun.spawnSync(['bash', '-c', editorInstallScript()], { cwd: dir })
  expect(result.exitCode).toBe(0)
}

test('installs the editor bridge and wires it into vite.config.ts once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-editor-'))
  writeFileSync(join(dir, 'vite.config.ts'), CONFIG)
  run(dir)
  expect(readFileSync(join(dir, '.siteformer/vite-plugin.ts'), 'utf8')).toBe(plugin)
  expect(readFileSync(join(dir, '.siteformer/bridge.js'), 'utf8')).toBe(bridge)
  expect(readFileSync(join(dir, '.siteformer/VERSION'), 'utf8').trim()).toBe(EDITOR_VERSION)
  const wired = readFileSync(join(dir, 'vite.config.ts'), 'utf8')
  expect(wired.startsWith('import { siteformer } from "./.siteformer/vite-plugin";\n')).toBe(true)
  expect(wired).toContain('plugins: [\n    siteformer(),\n    react(),')

  run(dir) // idempotent
  expect(readFileSync(join(dir, 'vite.config.ts'), 'utf8')).toBe(wired)
})

test('updates an older version and leaves a config it cannot wire alone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-editor-'))
  writeFileSync(join(dir, 'vite.config.ts'), 'export default {}\n')
  run(dir)
  writeFileSync(join(dir, '.siteformer/VERSION'), 'old\n')
  writeFileSync(join(dir, '.siteformer/bridge.js'), 'stale')
  run(dir)
  expect(readFileSync(join(dir, '.siteformer/bridge.js'), 'utf8')).toBe(bridge)
  expect(readFileSync(join(dir, 'vite.config.ts'), 'utf8')).toBe('export default {}\n')
})

test('leaves a config alone when wiring it would not parse', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-editor-'))
  const odd = 'const note = "plugins: [";\nexport default { plugins: [] }\n'
  writeFileSync(join(dir, 'vite.config.ts'), odd)
  run(dir)
  expect(readFileSync(join(dir, 'vite.config.ts'), 'utf8')).toBe(odd)
})

test('a failed install never wires the config (the dev server keeps working)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-editor-'))
  writeFileSync(join(dir, 'vite.config.ts'), CONFIG)
  writeFileSync(join(dir, '.siteformer'), 'not a folder') // mkdir fails
  run(dir)
  expect(readFileSync(join(dir, 'vite.config.ts'), 'utf8')).toBe(CONFIG)
})
