/**
 * Keeps the editor bridge (a dev-only Vite plugin, see vite-plugin.ts.txt and bridge.js.txt)
 * installed in a project at the current version. The shell snippet is idempotent and cheap when
 * nothing changed, so it runs on every setup, every open and after every restore.
 */
import { createHash } from 'node:crypto'
import bridgeSource from './bridge.js.txt?raw'
import pluginSource from './vite-plugin.ts.txt?raw'

export const EDITOR_VERSION = createHash('sha1')
  .update(pluginSource)
  .update(bridgeSource)
  .digest('hex')
  .slice(0, 12)

// Adds `siteformer()` first in vite.config.ts's plugins (its transform must run before the
// router's code splitting, so element locations point at the real file). The result is only
// written if it still parses, so an unusual config is left alone rather than broken.
const WIRE = `const fs = require("fs");
const file = "vite.config.ts";
const s = fs.readFileSync(file, "utf8");
const at = s.search(/plugins\\s*:\\s*\\[/);
if (at !== -1 && !s.includes("siteformer/vite-plugin")) {
  const open = s.indexOf("[", at) + 1;
  const next = 'import { siteformer } from "./.siteformer/vite-plugin";\\n' + s.slice(0, open) + "\\n    siteformer()," + s.slice(open);
  try {
    new Bun.Transpiler({ loader: "ts" }).transformSync(next);
    fs.writeFileSync(file, next);
  } catch {}
}`

const file = (name: string, content: string) =>
  [
    `base64 -d > .siteformer/${name}.tmp <<'SF_EOF'`,
    Buffer.from(content)
      .toString('base64')
      .replace(/.{1,76}/g, '$&\n')
      .trimEnd(),
    'SF_EOF',
  ].join('\n')

/**
 * Shell, run in the site's folder with bun on PATH. Never fails the caller (the editor is
 * optional): files are written to temp names and moved into place, and VERSION is written last,
 * so an interrupted install is simply redone next time.
 */
export function editorInstallScript(): string {
  return [
    `if [ "$(cat .siteformer/VERSION 2>/dev/null)" != "${EDITOR_VERSION}" ]; then (`,
    '  set -e',
    '  mkdir -p .siteformer',
    file('vite-plugin.ts', pluginSource),
    file('bridge.js', bridgeSource),
    '  mv .siteformer/vite-plugin.ts.tmp .siteformer/vite-plugin.ts',
    '  mv .siteformer/bridge.js.tmp .siteformer/bridge.js',
    `  echo ${EDITOR_VERSION} > .siteformer/VERSION`,
    ') || true; fi',
    'if [ -f vite.config.ts ] && [ -f .siteformer/vite-plugin.ts ] && ! grep -q "siteformer/vite-plugin" vite.config.ts; then',
    `  bun -e '${WIRE.replace(/'/g, `'\\''`)}' || true`,
    'fi',
  ].join('\n')
}
