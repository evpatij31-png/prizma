import { useEffect, useRef } from 'react'

import { SCOPE_LABELS, isFirstOccurrence, type SeriesScope } from '../../lib/series.ts'
import * as dt from '../../lib/datetime.ts'
import { useStore } from '../../store/useStore.ts'

const ORDER: SeriesScope[] = ['this', 'following', 'series']

const HINTS: Record<SeriesScope, string> = {
  this: 'Остальные вхождения не изменятся',
  following: 'Прошедшие вхождения останутся как были',
  series: 'Изменится каждое вхождение, включая прошедшие',
}

/**
 * Asked before a recurring event is changed, never after.
 *
 * The question has to come first because the three answers write different
 * records, and guessing wrong is the kind of mistake a user only notices
 * weeks later — when a meeting they thought they moved once turns out to have
 * moved every week.
 */
export function SeriesScopeDialog() {
  const pending = useStore((s) => s.pendingScope)
  const resolve = useStore((s) => s.resolveScope)
  const cancel = useStore((s) => s.cancelScope)
  const first = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (pending) first.current?.focus()
  }, [pending])

  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        cancel()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pending, cancel])

  if (!pending) return null

  const verb = pending.mode === 'delete' ? 'Удалить' : 'Изменить'
  // Splitting at the first occurrence is the same as the whole series, so
  // offering both would be a choice without a difference.
  const scopes = isFirstOccurrence(pending.event, pending.occurrenceStart)
    ? ORDER.filter((s) => s !== 'following')
    : ORDER

  return (
    <div className="fixed inset-0 z-50 grid place-items-end sm:place-items-center">
      <button
        type="button"
        aria-label="Отмена"
        onClick={cancel}
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${verb} повторяющееся событие`}
        className="pad-safe-b relative w-full rounded-t-2xl border border-edge bg-surface-1 p-4 shadow-[var(--shadow-panel)] sm:max-w-sm sm:rounded-2xl"
      >
        <h2 className="text-sm font-bold">{verb} повторяющееся событие</h2>
        <p className="mt-1 text-xs text-ink-dim">
          «{pending.title || 'Без названия'}» · {dt.formatRelativeDay(pending.occurrenceStart)}
          {dt.hasTime(pending.occurrenceStart) && `, ${dt.formatTime(pending.occurrenceStart)}`}
        </p>

        <div className="mt-3 flex flex-col gap-1.5">
          {scopes.map((scope, i) => (
            <button
              key={scope}
              ref={i === 0 ? first : undefined}
              type="button"
              onClick={() => void resolve(scope)}
              className="rounded-xl border border-edge bg-surface-2 px-3 py-2.5 text-left transition-colors hover:border-[var(--accent)] hover:bg-surface-3"
            >
              <span className="block text-sm font-semibold">{SCOPE_LABELS[scope]}</span>
              <span className="block text-[11px] text-ink-faint">{HINTS[scope]}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={cancel}
          className="mt-3 w-full rounded-lg px-3 py-2 text-sm font-semibold text-ink-dim hover:bg-surface-2"
        >
          Отмена
        </button>
      </div>
    </div>
  )
}
