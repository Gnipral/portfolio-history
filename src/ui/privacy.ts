import { useEffect, useState } from 'react'

/**
 * Hiding amounts is a choice of this device, like the theme: it is not part of the portfolio, so it
 * does not go into a backup or an account, and the demo follows it too.
 */
const STORAGE_KEY = 'portfolio-history:hide-amounts'

/** Fired on window when the choice changes, so the whole app follows at once. */
export const HIDE_AMOUNTS_EVENT = 'hideamountschange'

export function readHideAmounts(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function storeHideAmounts(hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(STORAGE_KEY, '1')
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Not persisted; the choice still applies until the page is reloaded.
  }
  window.dispatchEvent(new CustomEvent(HIDE_AMOUNTS_EVENT, { detail: hidden }))
}

export function useHideAmounts(): [boolean, (hidden: boolean) => void] {
  const [hidden, setHidden] = useState(readHideAmounts)
  useEffect(() => {
    const update = (event: Event) => setHidden((event as CustomEvent<boolean>).detail)
    window.addEventListener(HIDE_AMOUNTS_EVENT, update)
    return () => window.removeEventListener(HIDE_AMOUNTS_EVENT, update)
  }, [])
  return [hidden, storeHideAmounts]
}
