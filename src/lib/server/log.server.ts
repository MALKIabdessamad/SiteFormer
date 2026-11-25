/**
 * Structured logs: one JSON object per line on stdout/stderr. Railway parses these, so in the
 * Railway dashboard every field is filterable, e.g. `@level:error`, `@runId:run_123`,
 * `@event:tool`. Never log secrets, tokens or prompts in full.
 *
 * LOG_LEVEL = debug | info (default) | warn | error
 */

type Level = 'debug' | 'info' | 'warn' | 'error'
type Fields = Record<string, unknown>

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function threshold(): number {
  const level = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as Level
  return ORDER[level] ?? ORDER.info
}

/** Error → plain, loggable fields (message, code, first stack lines). */
export function errorFields(error: unknown): Fields {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code
    return {
      error: error.message,
      errorName: error.name,
      ...(code !== undefined ? { errorCode: code } : {}),
      stack: error.stack
        ?.split('\n')
        .slice(1, 6)
        .map((l) => l.trim())
        .join(' | '),
    }
  }
  return { error: typeof error === 'string' ? error : JSON.stringify(error) }
}

function write(level: Level, message: string, fields: Fields = {}) {
  if (ORDER[level] < threshold()) return
  const line = JSON.stringify(
    { level, message, time: new Date().toISOString(), ...fields },
    (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
  )
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`)
  else process.stdout.write(`${line}\n`)
}

export const log = {
  debug: (message: string, fields?: Fields) => write('debug', message, fields),
  info: (message: string, fields?: Fields) => write('info', message, fields),
  warn: (message: string, fields?: Fields) => write('warn', message, fields),
  error: (message: string, fields?: Fields) => write('error', message, fields),
  /** A child logger that adds the same fields to every line (e.g. runId, projectId). */
  with(base: Fields) {
    return {
      debug: (m: string, f?: Fields) => write('debug', m, { ...base, ...f }),
      info: (m: string, f?: Fields) => write('info', m, { ...base, ...f }),
      warn: (m: string, f?: Fields) => write('warn', m, { ...base, ...f }),
      error: (m: string, f?: Fields) => write('error', m, { ...base, ...f }),
    }
  },
}

/** Short, safe preview of user text for logs. */
export const preview = (text: string, max = 80) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}
