/**
 * Runs async work one at a time per key, in order (later calls wait for earlier ones, even when
 * those fail). For writes that must not interleave, e.g. two edits of the same file.
 */
export function serialQueue() {
  const tails = new Map<string, Promise<unknown>>()
  return function serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const next = (tails.get(key) ?? Promise.resolve()).catch(() => undefined).then(work)
    tails.set(key, next)
    const clear = () => {
      if (tails.get(key) === next) tails.delete(key)
    }
    next.then(clear, clear)
    return next
  }
}
