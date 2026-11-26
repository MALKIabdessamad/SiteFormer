// Lets tests import files with Vite's `?raw` suffix (as the app build does).
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { plugin } from 'bun'

plugin({
  name: 'raw',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: resolve(dirname(args.importer), args.path.replace(/\?raw$/, '')),
      namespace: 'raw',
    }))
    build.onLoad({ filter: /.*/, namespace: 'raw' }, (args) => ({
      contents: `export default ${JSON.stringify(readFileSync(args.path, 'utf8'))}`,
      loader: 'js',
    }))
  },
})
