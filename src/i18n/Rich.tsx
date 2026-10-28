import { Fragment, type ReactNode } from 'react'

/**
 * A translated sentence with elements in it: `<link>…</link>` in the text is replaced by
 * `tags.link('…')`, so the translation decides where the link goes.
 */
export function Rich({ text, tags }: { text: string; tags: Record<string, (content: string) => ReactNode> }) {
  const parts: ReactNode[] = []
  const pattern = /<(\w+)>(.*?)<\/\1>/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const [whole, name, content] = match as unknown as [string, string, string]
    parts.push(text.slice(last, match.index))
    const render = tags[name]
    parts.push(<Fragment key={match.index}>{render ? render(content) : content}</Fragment>)
    last = match.index + whole.length
  }
  parts.push(text.slice(last))
  return <>{parts}</>
}
