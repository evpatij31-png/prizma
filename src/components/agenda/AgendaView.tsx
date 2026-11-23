import { useMemo } from 'react'
import clsx from 'clsx'

import * as dt from '../../lib/datetime.ts'
import { lastVisibleDay } from '../../lib/occurrences.ts'
import { tasksOnDate } from '../../lib/tasks.ts'
import { swatch } from '../../lib/colors.ts'
import { useOccurrences, useVisibleRange } from '../../store/selectors.ts'
import { useStore } from '../../store/useStore.ts'
import type { Occurrence, Task } from '../../lib/types.ts'
import type { LocalDate } from '../../lib/datetime.ts'

/**
 * A flat list forward from the cursor.
 *
 * Days with nothing in them are left out rather than drawn empty: a list is
 * read by scanning, and a run of blank days is noise. The grid views are
 * where an empty day is information.
 */
export function AgendaView() {
  const occurrences = useOccurrences()
  const range = useVisibleRange()
  const tasks = useStore((s) => s.tasks)
  const selectedKey = useStore((s) => s.selectedKey)
  const openOccurrence = useStore((s) => s.openOccurrence)
  const toggleTaskDone = useStore((s) => s.toggleTaskDone)
  const setCursor = useStore((s) => s.setCursor)
  const setView = useStore((s) => s.setView)

  const days = useMemo(() => {
    const byDate = new Map<LocalDate, { events: Occurrence[]; tasks: Task[] }>()
    const bucket = (date: LocalDate) => {
      let found = byDate.get(date)
      if (!found) {
        found = { events: [], tasks: [] }
        byDate.set(date, found)
      }
      return found
    }

    for (const occ of occurrences) {
      for (const date of dt.datesBetween(occ.start, lastVisibleDay(occ))) {
        if (date < range.from || date >= range.to) continue
        bucket(date).events.push(occ)
      }
    }
    for (const date of dt.datesBetween(range.from, dt.dateOf(dt.addDays(range.to, -1)))) {
      const dated = tasksOnDate(tasks, date)
      if (dated.length) bucket(date).tasks.push(...dated)
    }

    return [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
  }, [occurrences, tasks, range])

  if (!days.length) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div>
          <p className="text-sm font-semibold">Впереди пусто</p>
          <p className="mt-1 text-xs text-ink-dim">
            Ближайшие {dt.diffDays(range.from, range.to)} дней ничем не заняты.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <ol className="mx-auto flex max-w-2xl flex-col gap-1 p-3">
        {days.map(([date, items]) => (
          <li key={date} className="animate-rise">
            <div className="flex gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-surface-2/60">
              <button
                type="button"
                onClick={() => {
                  void setCursor(date)
                  void setView('day')
                }}
                className="w-16 shrink-0 text-left"
                aria-label={`Открыть ${dt.formatDate(date)}`}
              >
                <span
                  className={clsx(
                    'block text-xl leading-none font-bold tabular-nums',
                    dt.isToday(date) ? 'text-[var(--today)]' : 'text-ink',
                  )}
                >
                  {dt.parse(date).d}
                </span>
                <span className="block text-[11px] font-semibold text-ink-faint uppercase">
                  {dt.formatWeekdayShort(date)}
                </span>
              </button>

              <div className="flex min-w-0 flex-1 flex-col gap-1">
                {items.events.map((occ) => (
                  <button
                    key={occ.key}
                    type="button"
                    onClick={() => openOccurrence(occ)}
                    title={`${occ.title || 'Без названия'} · ${dt.formatRange(occ.start, occ.end, occ.allDay)}`}
                    className={clsx(
                      'flex items-baseline gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-3',
                      occ.key === selectedKey && 'ring-2 ring-[var(--accent)]',
                    )}
                  >
                    <span
                      aria-hidden
                      className="mt-1 size-2.5 shrink-0 self-start rounded-full"
                      style={{ background: swatch(occ.color).dot }}
                    />
                    <span className="w-24 shrink-0 text-xs font-semibold tabular-nums text-ink-dim">
                      {occ.allDay ? 'весь день' : dt.formatTime(occ.start)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {occ.recurring && <span aria-hidden className="mr-1 opacity-60">⟳</span>}
                        {occ.title || 'Без названия'}
                      </span>
                      {occ.location && (
                        <span className="block truncate text-[11px] text-ink-faint">{occ.location}</span>
                      )}
                    </span>
                  </button>
                ))}

                {items.tasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => void toggleTaskDone(task.id)}
                    title={`${task.title} — отметить выполненной`}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-3"
                  >
                    <span aria-hidden className="w-2.5 shrink-0 text-[10px] text-ink-faint">☐</span>
                    <span className="w-24 shrink-0 text-xs font-semibold text-ink-faint">задача</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink-dim">{task.title}</span>
                  </button>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
