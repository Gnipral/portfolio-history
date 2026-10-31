/**
 * Whether the welcome flow has been seen on this device. It is a choice of the device, like the theme:
 * not part of the portfolio, so it does not go into a backup or the account.
 */
const STORAGE_KEY = 'portfolio-history:onboarded'

export function isOnboarded(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    // Without storage the flow would come back on every visit; show it, it can be skipped.
    return false
  }
}

export function markOnboarded(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    // Not persisted; the flow shows again next time.
  }
}
