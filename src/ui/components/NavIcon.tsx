const PATHS = {
  dashboard: 'M4 4h7v9H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 15h7v5H4z',
  analysis: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  import: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  transactions: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  prices: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  settings: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4',
} as const

export type NavIconName = keyof typeof PATHS

/** A line icon for the navigation; decorative, the link text names the page. */
export function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}
