import { useCallback, useEffect, useRef, useState } from 'react'
import { useIsDesktop } from '~/hooks/use-media-query'
import { storage } from '~/lib/utils/storage'

const COLLAPSED_KEY = 'siteform:sidebar'

/**
 * Sidebar state: collapsible on desktop (remembered), an off-canvas drawer on mobile.
 * Ctrl/⌘ + B toggles it, Escape closes the drawer.
 */
export function useSidebar() {
  const isDesktop = useIsDesktop()
  const [collapsed, setCollapsed] = useState(() => storage.get(COLLAPSED_KEY) === 'collapsed')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  // The drawer only exists below the desktop breakpoint.
  const open = drawerOpen && !isDesktop

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      storage.set(COLLAPSED_KEY, c ? 'expanded' : 'collapsed')
      return !c
    })
  }, [])

  const openDrawer = useCallback(() => setDrawerOpen(true), [])

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    menuButtonRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        if (isDesktop) toggleCollapsed()
        else setDrawerOpen((o) => !o)
      } else if (e.key === 'Escape' && open) {
        closeDrawer()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isDesktop, open, toggleCollapsed, closeDrawer])

  // Move focus into the drawer when it opens.
  useEffect(() => {
    if (open) closeButtonRef.current?.focus()
  }, [open])

  return {
    isDesktop,
    collapsed: isDesktop && collapsed,
    open,
    toggleCollapsed,
    openDrawer,
    closeDrawer,
    closeButtonRef,
    menuButtonRef,
  }
}
