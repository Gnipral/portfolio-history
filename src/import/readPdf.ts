import type { RawTable } from './types.ts'

interface TextItem {
  str: string
  transform: number[]
  width: number
  height: number
}

/** Items closer than this fraction of the text height count as the same line. */
const SAME_LINE = 0.5

/**
 * Joins the text items of one page into lines, top to bottom and left to right, the way PDFBox
 * writes them: words on the same baseline become one line, separated by single spaces.
 */
export function pageLines(items: TextItem[]): string[] {
  const words = items
    .filter((item) => item.str.trim() !== '')
    .map((item) => ({ text: item.str, x: item.transform[4] ?? 0, y: item.transform[5] ?? 0, width: item.width, height: Math.abs(item.height) || 10 }))
    .sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: (typeof words)[] = []
  for (const word of words) {
    const line = lines.at(-1)
    if (line && Math.abs((line[0]?.y ?? 0) - word.y) <= SAME_LINE * word.height) line.push(word)
    else lines.push([word])
  }
  return lines.map((line) => {
    line.sort((a, b) => a.x - b.x)
    let text = ''
    let end = -Infinity
    for (const word of line) {
      // A gap of more than a fraction of a character is a word break.
      if (text && word.x - end > word.height * 0.15 && !text.endsWith(' ') && !word.text.startsWith(' ')) text += ' '
      text += word.text
      end = word.x + word.width
    }
    return text.replace(/\s+/g, ' ').trim()
  })
}

/** Reads the text of a PDF statement or contract note, one line per text line, pages in order. */
export async function readPdf(fileName: string, data: ArrayBuffer): Promise<RawTable[]> {
  // pdf.js is large; load it only when a PDF is imported. The legacy build also runs on older browsers.
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')])
  // In Node (tests) pdf.js runs without a worker.
  if (typeof process === 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const task = pdfjs.getDocument({ data: new Uint8Array(data) })
  const pdf = await task.promise
  const pages: string[] = []
  try {
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number)
      const content = await page.getTextContent()
      pages.push(pageLines(content.items.filter((item): item is TextItem & typeof item => 'str' in item)).join('\n'))
    }
  } finally {
    await task.destroy()
  }
  return [{ fileName, rows: [], text: pages.join('\n') }]
}
