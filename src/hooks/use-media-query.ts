import { useCallback, useSyncExternalStore } from 'react'

/** Live result of a CSS media query. `serverValue` is used during SSR. */
export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  )
}

/** Matches Tailwind's `lg` breakpoint (1024px), where the sidebar becomes static. */
export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)', true)
