/**
 * Headless Chromium for the agent's browser tools, installed INSIDE the sandbox without root:
 * Playwright's headless shell plus the Debian libraries it needs, unpacked into a user folder.
 * Idempotent and serialized with a lock, so the background install (started when the sandbox
 * becomes ready) and a tool call never race. ~15 s the first time, instant afterwards.
 */
export const BROWSER_DIR = '/home/node/.siteformer/browser'
// Bump the version when the install changes: existing sandboxes then upgrade on next use.
const READY_MARKER = `${BROWSER_DIR}/.ready-v2`
const LIBS = `${BROWSER_DIR}/libs`

/** Libraries headless Chromium needs on Debian 12 that the base image may lack. */
const CHROMIUM_LIBS = [
  'libnspr4',
  'libnss3',
  'libdbus-1-3',
  'libatk1.0-0',
  'libatk-bridge2.0-0',
  'libatspi2.0-0',
  'libxcomposite1',
  'libxdamage1',
  'libxfixes3',
  'libxrandr2',
  'libgbm1',
  'libxkbcommon0',
  'libasound2',
  'libcups2',
  'libdrm2',
  'libxshmfence1',
  'libxi6',
  'libxtst6',
  'libwayland-server0',
  'libavahi-common3',
  'libavahi-client3',
  'fonts-liberation',
  'libxinerama1',
  'libxcursor1',
  'libepoxy0',
  'libpango-1.0-0',
  'libcairo2',
  'libx11-6',
  'libxext6',
  'libxrender1',
  'libxcb1',
  'libharfbuzz0b',
  'libfontconfig1',
  'libfreetype6',
].join(' ')

export const BROWSER_INSTALL_SCRIPT = `set -e
B=${BROWSER_DIR}
mkdir -p "$B"
exec 9>"$B.lock"
flock 9
[ -f ${READY_MARKER} ] && exit 0
mkdir -p "$B/libs" "$B/debs" "$HOME/.siteformer/apt/lists/partial" "$HOME/.siteformer/apt/cache/archives/partial"
cd "$B"
[ -f package.json ] || npm init -y >/dev/null
[ -f node_modules/playwright-core/package.json ] || npm i --silent --no-audit --no-fund playwright-core@1.56.1 >/tmp/sf-pw.log 2>&1
[ -f node_modules/axe-core/axe.min.js ] || npm i --silent --no-audit --no-fund axe-core@4.10.3 >/tmp/sf-axe.log 2>&1
npx playwright-core install chromium-headless-shell >/tmp/sf-chromium.log 2>&1
A="-o Dir::State::Lists=$HOME/.siteformer/apt/lists -o Dir::Cache=$HOME/.siteformer/apt/cache -o Debug::NoLocking=1"
NEED=""; for p in ${CHROMIUM_LIBS}; do dpkg -s "$p" >/dev/null 2>&1 || NEED="$NEED $p"; done
if [ -n "$NEED" ]; then
  apt-get $A update >/tmp/sf-apt.log 2>&1
  cd "$B/debs" && apt-get $A download $NEED >>/tmp/sf-apt.log 2>&1
  for f in *.deb; do dpkg -x "$f" "$B/libs"; done
  rm -f "$B"/debs/*.deb
fi
touch ${READY_MARKER}`

/** Environment that lets Chromium find the unpacked libraries. */
export const BROWSER_ENV = `LD_LIBRARY_PATH=${LIBS}/usr/lib/x86_64-linux-gnu:${LIBS}/lib/x86_64-linux-gnu FONTCONFIG_FILE=${LIBS}/etc/fonts/fonts.conf`

const singleQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

/** Starts the install in the background (detached); returns immediately. */
export const BROWSER_BACKGROUND_INSTALL = `cd /home/node && (nohup bash -c ${singleQuote(BROWSER_INSTALL_SCRIPT)} >/tmp/sf-browser-install.log 2>&1 &) ; echo started`
