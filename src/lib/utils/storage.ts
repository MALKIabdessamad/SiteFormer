/**
 * Web Storage helpers that never throw (private mode, blocked cookies, quota, SSR).
 */
type Area = 'local' | 'session'

function area(kind: Area): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

export const storage = {
  get(key: string, kind: Area = 'local'): string | null {
    try {
      return area(kind)?.getItem(key) ?? null
    } catch {
      return null
    }
  },
  set(key: string, value: string | null, kind: Area = 'local'): void {
    try {
      const s = area(kind)
      if (value === null) s?.removeItem(key)
      else s?.setItem(key, value)
    } catch {
      /* storage unavailable */
    }
  },
}
