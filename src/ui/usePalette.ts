import { useSyncExternalStore } from 'react'
import { currentPalette, PALETTE_EVENT, type Palette } from '../theme/theme.ts'

function subscribe(onChange: () => void): () => void {
  window.addEventListener(PALETTE_EVENT, onChange)
  return () => window.removeEventListener(PALETTE_EVENT, onChange)
}

/** The palette of the chart block; every user re-renders when it is changed anywhere. */
export function usePalette(): Palette {
  return useSyncExternalStore(subscribe, currentPalette, () => 'standard' as const)
}
