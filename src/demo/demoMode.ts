/**
 * Demo mode: the app runs on its own IndexedDB database filled with a made-up portfolio, so it can
 * be tried (and tested) without a broker export. The own database is never touched.
 */
const FLAG = 'portfolio-history:demo'

export const DEMO_DATABASE = 'portfolio-history-demo'

export function isDemo(): boolean {
  try {
    return localStorage.getItem(FLAG) === '1'
  } catch {
    return false
  }
}

function restart() {
  // A fresh start opens the other database; every module keeps using the one it got.
  window.location.hash = '#/'
  window.location.reload()
}

export function enterDemo(): void {
  try {
    localStorage.setItem(FLAG, '1')
  } catch {
    return
  }
  restart()
}

export function leaveDemo(): void {
  try {
    localStorage.removeItem(FLAG)
  } catch {
    // Nothing stored, nothing to undo.
  }
  restart()
}
