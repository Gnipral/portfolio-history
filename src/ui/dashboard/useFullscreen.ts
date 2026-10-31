import { useEffect, useRef, useState, type RefObject } from 'react'

/** Element full screen where the browser has it (not on iPhone); otherwise the element fills the window. */
function canFullscreen(element: HTMLElement | null): boolean {
  return Boolean(element?.requestFullscreen && document.fullscreenEnabled)
}

/**
 * Full screen as in a video player: the button, F to toggle, Esc to leave. Where the browser refuses, the
 * element fills the window instead (the `expanded` class does that).
 */
export function useFullscreen(element: RefObject<HTMLElement | null>): [boolean, () => void] {
  const [expanded, setExpanded] = useState(false)

  function toggle() {
    const target = element.current
    if (expanded && !document.fullscreenElement) {
      setExpanded(false)
    } else if (canFullscreen(target)) {
      if (document.fullscreenElement) void document.exitFullscreen()
      // Refused (no user gesture, an iframe without permission): fill the window instead.
      else target?.requestFullscreen().catch(() => setExpanded(true))
    } else {
      setExpanded((value) => !value)
    }
  }
  const toggleRef = useRef(toggle)
  toggleRef.current = toggle

  useEffect(() => {
    const onChange = () => setExpanded(document.fullscreenElement === element.current && element.current !== null)
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof Element && e.target.closest('input, select, textarea, [contenteditable="true"]')
      if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing) toggleRef.current()
      else if (e.key === 'Escape' && !document.fullscreenElement) setExpanded(false)
    }
    document.addEventListener('fullscreenchange', onChange)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      document.removeEventListener('keydown', onKey)
    }
  }, [element])

  return [expanded, toggle]
}
