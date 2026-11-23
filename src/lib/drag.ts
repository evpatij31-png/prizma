/**
 * What a drag does to an event's times.
 *
 * Deliberately separate from the pointer plumbing: "drag the bottom edge of a
 * 30-minute meeting up past its own start" is a rule, not a gesture, and it
 * belongs somewhere a test can reach. The component only has to turn pointer
 * events into `{ date, minutes }` and hand them here.
 */

import * as dt from './datetime.ts'
import type { Local, LocalDate, LocalDateTime } from './datetime.ts'

export type DragKind = 'create' | 'move' | 'resize-start' | 'resize-end'

export interface DragOrigin {
  kind: DragKind
  /** Minutes-of-day where the pointer went down. */
  anchorMinutes: number
  /** The column the pointer went down in. */
  anchorDate: LocalDate
  /** The event's times when the drag began. */
  start: Local
  end: Local
  allDay: boolean
}

/** Where the pointer is now. */
export interface DragPoint {
  date: LocalDate
  minutes: number
}

export interface DragOptions {
  /** Shortest event a drag may produce. */
  minMinutes?: number
  /** Latest minute-of-day the grid shows; a drag cannot run past it. */
  dayEndHour?: number
}

export interface DragResult {
  start: LocalDateTime
  end: LocalDateTime
}

/** A time on a given day, rolling into the next day past midnight. */
export function atMinutes(date: LocalDate, minutes: number): LocalDateTime {
  const days = Math.floor(minutes / 1440)
  const rest = minutes - days * 1440
  return dt.withTime(dt.dateOf(dt.addDays(date, days)), rest)
}

/**
 * Apply a drag and get the new times.
 *
 * Never returns a zero-length or inverted event: every branch enforces
 * `minMinutes`, which is what lets the grid render the result without
 * special-casing a backwards drag.
 */
export function applyDrag(origin: DragOrigin, point: DragPoint, options: DragOptions = {}): DragResult {
  const minMinutes = options.minMinutes ?? 15
  const limit = (options.dayEndHour ?? 24) * 60

  switch (origin.kind) {
    case 'create': {
      // A create drag stays in the column it started in: dragging sideways
      // across days while painting a time range reads as a mistake, not intent.
      const a = Math.min(origin.anchorMinutes, point.minutes)
      const b = Math.max(origin.anchorMinutes, point.minutes)
      const end = Math.max(b, a + minMinutes)
      return {
        start: atMinutes(origin.anchorDate, a),
        end: atMinutes(origin.anchorDate, Math.min(end, limit)),
      }
    }

    case 'move': {
      const duration = Math.max(minMinutes, dt.diffMinutes(origin.start, origin.end))
      const dayDelta = dt.diffDays(origin.anchorDate, point.date)
      const minuteDelta = point.minutes - origin.anchorMinutes
      const start = dt.addMinutes(dt.addDays(origin.start, dayDelta), minuteDelta)
      return { start, end: dt.addMinutes(start, duration) }
    }

    case 'resize-end': {
      // The start stays put; the end cannot be dragged above it.
      const startMinutes = dt.minutesOfDay(origin.start)
      const dayDelta = dt.diffDays(dt.dateOf(origin.start), point.date)
      const target = point.minutes + dayDelta * 1440
      const end = Math.max(target, startMinutes + minMinutes)
      return { start: origin.start as LocalDateTime, end: atMinutes(dt.dateOf(origin.start), end) }
    }

    case 'resize-start': {
      // The end stays put; the start cannot be dragged below it.
      const endMinutes = dt.minutesOfDay(origin.end) + dt.diffDays(dt.dateOf(origin.start), dt.dateOf(origin.end)) * 1440
      const dayDelta = dt.diffDays(dt.dateOf(origin.start), point.date)
      const target = point.minutes + dayDelta * 1440
      const start = Math.min(target, endMinutes - minMinutes)
      return { start: atMinutes(dt.dateOf(origin.start), start), end: origin.end as LocalDateTime }
    }
  }
}

/** Did the pointer move far enough to count as a drag rather than a click? */
export function isDrag(from: { x: number; y: number }, to: { x: number; y: number }, threshold = 4): boolean {
  return Math.abs(to.x - from.x) >= threshold || Math.abs(to.y - from.y) >= threshold
}

/**
 * Move an all-day event between days in the month grid, keeping its length.
 * Returns date-only values, with the exclusive end the storage format wants.
 */
export function moveByDays(start: Local, end: Local, days: number): DragResult {
  if (days === 0) return { start: start as LocalDateTime, end: end as LocalDateTime }
  return {
    start: dt.addDays(start, days) as LocalDateTime,
    end: dt.addDays(end, days) as LocalDateTime,
  }
}
