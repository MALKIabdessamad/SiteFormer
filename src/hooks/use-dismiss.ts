import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react'

/**
 * Closes an open popover on a pointer down outside `root`, when the page loses focus (a click in
 * an iframe, like the site preview, never reaches this document), or on Escape (focus then
 * returns to `trigger`, so keyboard users land where they started).
 */
export function useDismiss(
  open: boolean,
  setOpen: Dispatch<SetStateAction<boolean>>,
  root: RefObject<HTMLElement | null>,
  trigger?: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onBlur = () => setOpen(false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      trigger?.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onBlur)
    }
  }, [open, setOpen, root, trigger])
}
