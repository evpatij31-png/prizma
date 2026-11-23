/**
 * What each view shows, and how much data it needs.
 *
 * Pure on purpose: the store asks these functions what to load and what to
 * title the header, so "which month am I looking at" is testable without
 * mounting anything.
 */

import * as dt from './datetime.ts'
import type { Local, LocalDate, WeekStart } from './datetime.ts'
import type { Range } from './occurrences.ts'
import type { ViewMode } from './types.ts'

/** How far ahead the agenda looks. */
const AGENDA_DAYS = 60

/**
 * Padding around the visible window, so paging does not wait on a query.
 *
 * It has to beat a whole month *step*, which is more than a month's length: a
 * 6x7 grid overhangs its month by up to 6 days at each end, so stepping from
 * November to December can move the far edge by ~37 days. 31 is not enough —
 * 45 leaves margin while still letting a two-month jump trigger a refetch.
 */
const PREFETCH_DAYS = 45

/** The half-open window of days a view draws. */
export function visibleRange(view: ViewMode, cursor: LocalDate, weekStart: WeekStart = 1): Range {
  switch (view) {
    case 'month': {
      const grid = dt.monthGrid(cursor, weekStart)
      return { from: grid[0], to: dt.dateOf(dt.addDays(grid[grid.length - 1], 1)) }
    }
    case 'week': {
      const week = dt.weekDates(cursor, weekStart)
      return { from: week[0], to: dt.dateOf(dt.addDays(week[6], 1)) }
    }
    case 'day':
      return { from: dt.dateOf(cursor), to: dt.dateOf(dt.addDays(cursor, 1)) }
    case 'agenda':
      return { from: dt.dateOf(cursor), to: dt.dateOf(dt.addDays(cursor, AGENDA_DAYS)) }
  }
}

/**
 * The window to actually fetch: the visible one plus a month either side.
 * Paging a month then lands inside what is already loaded.
 */
export function loadRange(visible: Range): Range {
  return {
    from: dt.dateOf(dt.addDays(visible.from, -PREFETCH_DAYS)),
    to: dt.dateOf(dt.addDays(visible.to, PREFETCH_DAYS)),
  }
}

/** Does `outer` fully contain `inner`? */
export function covers(outer: Range | null, inner: Range): boolean {
  if (!outer) return false
  return outer.from <= inner.from && outer.to >= inner.to
}

/** Move the cursor one step in the view's own unit. */
export function stepCursor(view: ViewMode, cursor: LocalDate, direction: -1 | 1): LocalDate {
  switch (view) {
    case 'month':
      return dt.dateOf(dt.addMonths(cursor, direction))
    case 'week':
      return dt.dateOf(dt.addDays(cursor, 7 * direction))
    case 'day':
      return dt.dateOf(dt.addDays(cursor, direction))
    case 'agenda':
      return dt.dateOf(dt.addDays(cursor, 14 * direction))
  }
}

/** Header title: "ноябрь 2026", "17 – 23 нояб.", "воскресенье, 22 ноября 2026". */
export function titleFor(view: ViewMode, cursor: LocalDate, weekStart: WeekStart = 1): string {
  switch (view) {
    case 'month':
      return capitalise(dt.formatMonthYear(cursor))
    case 'week': {
      const week = dt.weekDates(cursor, weekStart)
      const sameMonth = week[0].slice(0, 7) === week[6].slice(0, 7)
      return sameMonth
        ? `${dt.parse(week[0]).d} – ${capitalise(dt.formatDate(week[6]))}`
        : `${dt.formatDateShort(week[0])} – ${dt.formatDateShort(week[6])} ${dt.parse(week[6]).y}`
    }
    case 'day':
      return capitalise(`${dt.formatWeekdayLong(cursor)}, ${dt.formatDate(cursor)}`)
    case 'agenda':
      return `С ${dt.formatDateShort(cursor)}`
  }
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Is `date` inside the month the cursor points at? Month view dims the rest. */
export function inCursorMonth(date: Local, cursor: LocalDate): boolean {
  return date.slice(0, 7) === cursor.slice(0, 7)
}

/** ISO 8601 week number, for the optional week-number gutter. */
export function weekNumber(date: LocalDate): number {
  const p = dt.parse(date)
  const thursday = new Date(Date.UTC(p.y, p.m - 1, p.d))
  // ISO weeks are defined by the Thursday they contain.
  const day = (thursday.getUTCDay() + 6) % 7
  thursday.setUTCDate(thursday.getUTCDate() - day + 3)
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4))
  const firstDay = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3)
  return 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86_400_000))
}

export const VIEW_LABELS: Record<ViewMode, { label: string; hotkey: string }> = {
  month: { label: 'Месяц', hotkey: 'M' },
  week: { label: 'Неделя', hotkey: 'W' },
  day: { label: 'День', hotkey: 'D' },
  agenda: { label: 'Список', hotkey: 'A' },
}
