import { useState } from 'react'

const KEY = 'portfolio-history:side-panel'

/** Whether the side panel of the chart is open: open by default, and the choice is remembered on this device. */
export function readPanelOpen(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'closed'
  } catch {
    return true
  }
}

export function usePanelOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(readPanelOpen)
  return [
    open,
    (next: boolean) => {
      setOpen(next)
      try {
        if (next) localStorage.removeItem(KEY)
        else localStorage.setItem(KEY, 'closed')
      } catch {
        // Not remembered; the choice holds until the page is reloaded.
      }
    },
  ]
}
