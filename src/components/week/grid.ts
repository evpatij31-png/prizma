/**
 * Geometry shared by the week and day grids.
 *
 * Kept out of the components so the awkward parts — where a pointer lands in
 * minutes, how a multi-day bar is packed into the all-day row — are plain
 * functions with tests rather than something only reproducible by dragging.
 */

import * as dt from '../../lib/datetime.ts'
import { lastVisibleDay } from '../../lib/occurrences.ts'
import type { Occurrence } from '../../lib/types.ts'
import type { LocalDate } from '../../lib/datetime.ts'

/** Height of one hour, in pixels. */
export const HOUR_PX = 56

/** Width of the hour-label gutter. */
export const GUTTER = '3.25rem'

export function gridTemplate(columns: number): string {
  return `${GUTTER} repeat(${columns}, minmax(0, 1fr))`
}

/** Pixel height of the whole hour grid. */
export function gridHeight(dayStartHour: number, dayEndHour: number): number {
  return Math.max(1, dayEndHour - dayStartHour) * HOUR_PX
}

/**
 * Where a pointer at `offsetY` inside the grid lands, in minutes from midnight.
 * Snapped, and clamped to the visible hours so a drag off the top of the
 * column cannot produce a negative time.
 */
export function minutesAt(
  offsetY: number,
  { dayStartHour, dayEndHour, snapMinutes }: { dayStartHour: number; dayEndHour: number; snapMinutes: number },
): number {
  const raw = dayStartHour * 60 + (offsetY / HOUR_PX) * 60
  const snapped = dt.snap(raw, snapMinutes)
  return Math.max(dayStartHour * 60, Math.min(dayEndHour * 60, snapped))
}

/** The inverse: pixel offset of a minute-of-day inside the grid. */
export function offsetOf(minutes: number, dayStartHour: number): number {
  return ((minutes - dayStartHour * 60) / 60) * HOUR_PX
}

/** Hour labels for the gutter. */
export function hourLabels(dayStartHour: number, dayEndHour: number): { hour: number; label: string }[] {
  const out: { hour: number; label: string }[] = []
  for (let hour = dayStartHour; hour < dayEndHour; hour++) {
    out.push({ hour, label: `${String(hour).padStart(2, '0')}:00` })
  }
  return out
}

/* ------------------------------ all-day bars ------------------------------ */

export interface AllDayBar {
  occ: Occurrence
  /** 0-based column index within the visible dates. */
  startIndex: number
  /** Inclusive end column. */
  endIndex: number
  /** Stacking row, 0-based. */
  row: number
}

/**
 * Pack all-day occurrences into horizontal bars across the visible dates.
 *
 * A bar is clipped to the window, so a trip that began last week still shows
 * as running off the left edge. Bars that would overlap are pushed onto the
 * next row, which is what makes a week of overlapping holidays readable.
 */
export function layoutAllDay(occurrences: Occurrence[], dates: LocalDate[]): AllDayBar[] {
  if (!dates.length) return []
  const first = dates[0]
  const last = dates[dates.length - 1]

  const bars = occurrences
    .map((occ) => {
      const from = dt.dateOf(occ.start)
      const to = lastVisibleDay(occ)
      if (to < first || from > last) return null
      return {
        occ,
        startIndex: Math.max(0, dt.diffDays(first, from)),
        endIndex: Math.min(dates.length - 1, dt.diffDays(first, to)),
        row: 0,
      }
    })
    .filter((b): b is AllDayBar => b !== null)
    // Longest first, so a week-long bar takes the top row and short ones
    // tuck underneath instead of fragmenting it.
    .sort((a, b) => b.endIndex - b.startIndex - (a.endIndex - a.startIndex) || a.startIndex - b.startIndex)

  /** Per row, the last column already taken. */
  const rowEnds: number[] = []
  for (const bar of bars) {
    let row = rowEnds.findIndex((end) => end < bar.startIndex)
    if (row === -1) {
      row = rowEnds.length
      rowEnds.push(bar.endIndex)
    } else {
      rowEnds[row] = bar.endIndex
    }
    bar.row = row
  }

  return bars
}

/** How many stacked rows the all-day area needs. */
export function allDayRowCount(bars: AllDayBar[]): number {
  return bars.reduce((max, b) => Math.max(max, b.row + 1), 0)
}
