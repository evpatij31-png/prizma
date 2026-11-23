/**
 * Saving a file from the page, and reading one back.
 *
 * Kept in one place so the desktop and mobile wrappers have a single function
 * to replace when they want a native save dialog instead of a blob link.
 */

export function downloadText(filename: string, text: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function downloadIcs(filename: string, text: string): void {
  downloadText(filename, text, 'text/calendar;charset=utf-8')
}

export function downloadJson(filename: string, data: unknown): void {
  downloadText(filename, JSON.stringify(data, null, 2), 'application/json;charset=utf-8')
}

/** Read a picked file as text. */
export function readFile(file: File): Promise<string> {
  return file.text()
}
