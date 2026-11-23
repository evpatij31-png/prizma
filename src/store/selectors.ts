/**
 * Derived views of the store.
 *
 * Each hook subscribes to the narrowest slice it can and memoises the
 * expensive part. Returning a fresh array straight out of a zustand selector
 * would re-render the whole grid on every unrelated change, so the recurrence
 * expansion happens inside `useMemo` keyed on the inputs that matter.
 */

import { useMemo } from 'react'
import { useStore } from './useStore.ts'
import { groupByDate, queryOccurrences, splitAllDay, type Range } from '../lib/occurrences.ts'
import { visibleRange } from '../lib/view.ts'
import * as dt from '../lib/datetime.ts'
import type { Occurrence } from '../lib/types.ts'
import type { LocalDate } from '../lib/datetime.ts'

export function useVisibleRange(): Range {
  const view = useStore((s) => s.view)
  const cursor = useStore((s) => s.cursor)
  const weekStart = useStore((s) => s.settings.weekStart)
  return useMemo(() => visibleRange(view, cursor, weekStart), [view, cursor, weekStart])
}

/** Every occurrence inside the visible window, ascending. */
export function useOccurrences(): Occurrence[] {
  const events = useStore((s) => s.events)
  const calendars = useStore((s) => s.calendars)
  const range = useVisibleRange()
  return useMemo(() => queryOccurrences(events, calendars, range), [events, calendars, range])
}

/** The days of the month grid, and what falls on each. */
export function useMonthGrid(): { dates: LocalDate[]; byDate: Map<LocalDate, Occurrence[]> } {
  const cursor = useStore((s) => s.cursor)
  const weekStart = useStore((s) => s.settings.weekStart)
  const occurrences = useOccurrences()

  const dates = useMemo(() => dt.monthGrid(cursor, weekStart), [cursor, weekStart])
  const byDate = useMemo(() => groupByDate(occurrences, dates), [occurrences, dates])

  return { dates, byDate }
}

/** The all-day row and the hour grid for one day. */
export function useDaySplit(date: LocalDate) {
  const occurrences = useOccurrences()
  return useMemo(() => {
    const sameDay = occurrences.filter((o) => {
      const start = dt.dateOf(o.start)
      const end = dt.dateOf(o.end)
      return start <= date && date <= end
    })
    return splitAllDay(sameDay)
  }, [occurrences, date])
}

export function useCalendarById() {
  const calendars = useStore((s) => s.calendars)
  return useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars])
}

/** The calendar a new event should land in: the first writable, visible one. */
export function useDefaultCalendarId(): string | null {
  const calendars = useStore((s) => s.calendars)
  return useMemo(() => calendars.find((c) => !c.readOnly && c.visible)?.id ?? calendars[0]?.id ?? null, [calendars])
}
