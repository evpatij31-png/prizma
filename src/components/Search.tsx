import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'

import { search } from '../lib/search.ts'
import { useOccurrences, useVisibleRange } from '../store/selectors.ts'
import { useStore } from '../store/useStore.ts'
import * as dt from '../lib/datetime.ts'

/**
 * Search over what is loaded.
 *
 * The footer states the window that was searched. The alternative — saying
 * nothing — leaves the user to conclude that an event they know exists has
 * been lost, when it is simply outside the loaded range.
 */
export function Search({ onClose }: { onClose(): void }) {
  const occurrences = useOccurrences()
  const tasks = useStore((s) => s.tasks)
  const range = useVisibleRange()
  const openOccurrence = useStore((s) => s.openOccurrence)
  const setCursor = useStore((s) => s.setCursor)
  const loaded = useStore((s) => s.loaded)

  const [query, setQuery] = useState('')
  const [cursor, setCursorIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  const hits = useMemo(() => search(occurrences, tasks, query), [occurrences, tasks, query])

  useEffect(() => {
    input.current?.focus()
  }, [])

  useEffect(() => {
    setCursorIndex(0)
  }, [query])

  const choose = (index: number) => {
    const hit = hits[index]
    if (!hit) return
    void setCursor(hit.date)
    if (hit.occurrence) openOccurrence(hit.occurrence)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-10">
      <button type="button" aria-label="Закрыть поиск" onClick={onClose} className="absolute inset-0 bg-black/55" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Поиск"
        className="relative flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-edge bg-surface-1 shadow-[var(--shadow-panel)]"
      >
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setCursorIndex((i) => Math.min(i + 1, hits.length - 1))
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setCursorIndex((i) => Math.max(i - 1, 0))
            }
            if (e.key === 'Enter') choose(cursor)
          }}
          placeholder="Название, место или описание…"
          aria-label="Поисковый запрос"
          className="shrink-0 border-b border-edge bg-transparent px-4 py-3.5 text-base outline-none"
        />

        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
          {query.trim() && hits.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-ink-dim">
              Ничего не найдено по запросу «{query.trim()}»
            </p>
          )}

          {hits.map((hit, index) => (
            <button
              key={hit.key}
              type="button"
              onClick={() => choose(index)}
              onPointerEnter={() => setCursorIndex(index)}
              className={clsx(
                'flex w-full items-baseline gap-2.5 px-4 py-2.5 text-left transition-colors',
                index === cursor ? 'bg-surface-3' : 'hover:bg-surface-2',
              )}
            >
              <span aria-hidden className="shrink-0 text-xs opacity-60">
                {hit.kind === 'task' ? '☐' : '●'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{hit.title}</span>
                <span className="block truncate text-[11px] text-ink-faint">{hit.when}</span>
              </span>
            </button>
          ))}
        </div>

        <p className="shrink-0 border-t border-edge px-4 py-2 text-[11px] text-ink-faint">
          {loaded
            ? `Ищем среди загруженного: ${dt.formatDateShort(loaded.from)} – ${dt.formatDateShort(loaded.to)}. Поиск по всей истории появится позже.`
            : `Ищем в текущем интервале: ${dt.formatDateShort(range.from)} – ${dt.formatDateShort(range.to)}.`}
        </p>
      </div>
    </div>
  )
}
