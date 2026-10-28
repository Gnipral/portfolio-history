const ISSUES = 'https://github.com/Gnipral/portfolio-history/issues/new'

/** The route without the data of a shared card or comparison, which can hold someone's figures. */
export function safeRoute(path: string): string {
  return path.replace(/^\/(s|c)\/.+$/, '/$1/…')
}

/**
 * A prefilled GitHub issue for an error: the message, the top of the stack, the page and the browser.
 * Never amounts or transactions; the user sees the text before submitting it.
 */
export function reportUrl(error: unknown, path: string, userAgent = navigator.userAgent): string {
  const e = error instanceof Error ? error : new Error(String(error))
  const stack = (e.stack ?? '').split('\n').slice(0, 8).join('\n')
  const body = [
    '**What were you doing?**',
    '',
    '',
    '**Error**',
    '```',
    `${e.name}: ${e.message}`.slice(0, 500),
    stack,
    '```',
    `Page: \`${safeRoute(path)}\``,
    `Browser: ${userAgent}`,
  ].join('\n')
  const params = new URLSearchParams({ title: `Error: ${e.message}`.slice(0, 120), body, labels: 'bug' })
  return `${ISSUES}?${params}`
}
