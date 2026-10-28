import { useEffect, useMemo, useRef, useState } from 'react'
import type { DailyPoint } from '../../engine/series.ts'
import type { Slice } from '../dashboard/allocation.ts'
import type { BenchmarkLine } from '../dashboard/benchmarkLines.ts'
import { cardFile, drawShareCard, loadCardFonts, type ShareFormat } from './drawShareCard.ts'
import { shareCard, shareText } from './shareCard.ts'

interface Props {
  points: DailyPoint[]
  from: number
  to: number
  benchmarks: BenchmarkLine[]
  /** The value per type of asset on the last day. */
  slices: Slice[]
  onClose: () => void
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Makes a picture of the return in percent to post or send, with a text to go with it. */
export function ShareDialog({ points, from, to, benchmarks, slices, onClose }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [format, setFormat] = useState<ShareFormat>('wide')
  const [compare, setCompare] = useState(true)
  const [showAllocation, setShowAllocation] = useState(true)
  const [fontsReady, setFontsReady] = useState(false)
  const [status, setStatus] = useState('')
  const benchmark = compare ? benchmarks[0] : undefined
  const card = useMemo(() => shareCard(points, from, to, benchmark, slices), [points, from, to, benchmark, slices])
  const text = shareText(card)

  useEffect(() => {
    void loadCardFonts().then(() => setFontsReady(true))
  }, [])

  useEffect(() => {
    if (canvas.current) drawShareCard(canvas.current, card, format, showAllocation)
  }, [card, format, showAllocation, fontsReady])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const file = () => (canvas.current ? cardFile(canvas.current, card) : Promise.resolve(null))

  // The text goes to the clipboard on every share or download: most apps drop it next to an image.
  const share = async () => {
    const copied = await copy(text)
    const image = await file()
    if (image && navigator.canShare?.({ files: [image] })) {
      try {
        await navigator.share({ files: [image], text })
        setStatus(copied ? 'Shared. The text is on your clipboard too.' : 'Shared.')
      } catch {
        // Closed the share sheet: nothing to report.
      }
      return
    }
    await download(copied)
  }

  const download = async (copied?: boolean) => {
    const image = await file()
    if (!image) return
    const url = URL.createObjectURL(image)
    const link = document.createElement('a')
    link.href = url
    link.download = image.name
    link.click()
    URL.revokeObjectURL(url)
    const textCopied = copied ?? (await copy(text))
    setStatus(textCopied ? 'Image saved. The text is on your clipboard: paste it with the image.' : 'Image saved.')
  }

  return (
    <div className="share-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title">
        <div className="panel-header">
          <h3 id="share-title">Share your return</h3>
          <button type="button" className="share-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="muted small">Only percentages and dates: no amounts, quantities or product names.</p>
        <canvas ref={canvas} className={`share-preview ${format}`} role="img" aria-label={text} />
        <div className="share-options">
          <div className="segmented" role="group" aria-label="Format">
            <button type="button" aria-pressed={format === 'wide'} onClick={() => setFormat('wide')}>
              Post
            </button>
            <button type="button" aria-pressed={format === 'story'} onClick={() => setFormat('story')}>
              Story
            </button>
          </div>
          {benchmarks[0] && (
            <label>
              <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> Compare with {benchmarks[0].label}
            </label>
          )}
          {slices.length > 0 && (
            <label>
              <input type="checkbox" checked={showAllocation} onChange={(e) => setShowAllocation(e.target.checked)} /> Show the mix by type
            </label>
          )}
        </div>
        <textarea className="share-text" readOnly value={text} rows={3} aria-label="Text to go with it" />
        <div className="share-actions">
          <button type="button" className="primary" onClick={() => void share()}>
            Share
          </button>
          <button type="button" onClick={() => void download()}>
            Download image
          </button>
          <button type="button" onClick={() => void copy(text).then((ok) => setStatus(ok ? 'Text copied.' : 'Copying is not allowed here.'))}>
            Copy text
          </button>
        </div>
        <p className="small" role="status">
          {status}
        </p>
      </div>
    </div>
  )
}
