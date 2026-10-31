import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useSettings } from '../../settings/settings.ts'
import { indexOfDate, periodRange, visibleRange, type RangeKey, type VisibleRange } from '../dashboard/timeRange.ts'

/**
 * The period shown, shared by the Dashboard and Analysis: changing it on one page changes it on the other.
 * Either a quick range, or a window set by hand (with the timeline or a saved period); `to` null runs up to
 * the last day, so a window up to today grows along.
 */
export type PeriodSelection = { kind: 'range'; range: RangeKey } | { kind: 'window'; from: string; to: string | null; savedId?: string }

interface PeriodContextValue {
  selection: PeriodSelection
  /** The day the snapshot shows when set by hand ("pinned"); null: the end of the period. */
  playhead: string | null
  setRange: (range: RangeKey) => void
  setWindow: (from: string, to: string | null, savedId?: string) => void
  setPlayhead: (date: string | null) => void
}

const PeriodContext = createContext<PeriodContextValue | null>(null)

export function PeriodProvider({ children }: { children: ReactNode }) {
  const launchRange = useSettings()?.launchRange
  // Until the settings are read, and until the user picks something, the period is the launch range.
  const [chosen, setChosen] = useState<PeriodSelection | null>(null)
  const [playhead, setPlayhead] = useState<string | null>(null)
  const selection: PeriodSelection = chosen ?? { kind: 'range', range: launchRange ?? 'ALL' }

  const setRange = useCallback((range: RangeKey) => {
    setChosen({ kind: 'range', range })
    setPlayhead(null)
  }, [])
  const setWindow = useCallback((from: string, to: string | null, savedId?: string) => {
    setChosen({ kind: 'window', from, to, ...(savedId ? { savedId } : {}) })
  }, [])

  const value = useMemo(() => ({ selection, playhead, setRange, setWindow, setPlayhead }), [selection, playhead, setRange, setWindow])
  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>
}

/** A period of its own for a page rendered outside the provider, as in a test. */
function useLocalPeriod(): PeriodContextValue {
  const [selection, setSelection] = useState<PeriodSelection>({ kind: 'range', range: 'ALL' })
  const [playhead, setPlayhead] = useState<string | null>(null)
  return {
    selection,
    playhead,
    setRange: (range) => {
      setSelection({ kind: 'range', range })
      setPlayhead(null)
    },
    setWindow: (from, to, savedId) => setSelection({ kind: 'window', from, to, ...(savedId ? { savedId } : {}) }),
    setPlayhead,
  }
}

export interface ResolvedPeriod extends PeriodContextValue {
  /** The visible window as indices into the daily points. */
  visible: VisibleRange
  /** Index of the playhead, inside `visible`; the end of the period when not pinned. */
  selected: number
  pinned: boolean
}

/** The shared period, resolved against a daily series. */
export function usePeriod(points: readonly { date: string }[]): ResolvedPeriod {
  const shared = useContext(PeriodContext)
  const local = useLocalPeriod()
  const period = shared ?? local
  const { selection, playhead } = period
  const visible = useMemo(
    () => (selection.kind === 'range' ? visibleRange(points as { date: string }[], selection.range) : periodRange(points as { date: string }[], selection)),
    [points, selection],
  )
  const first = points[0]?.date
  const pinnedIndex = playhead && first ? indexOfDate(first, playhead) : null
  const pinned = pinnedIndex !== null && pinnedIndex >= visible.from && pinnedIndex <= visible.to
  return { ...period, visible, selected: pinned ? pinnedIndex : visible.to, pinned }
}
