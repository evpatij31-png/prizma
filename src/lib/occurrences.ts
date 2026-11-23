/**
 * From stored events to things on screen.
 *
 * `queryOccurrences` turns events (some of them recurring series) into the
 * concrete appearances a view draws. `layoutDay` then packs the timed ones
 * into a day column. Both are pure: no React, no store, no database — which
 * is what lets the awkward cases be pinned down by tests instead of by
 * clicking around.
 */

import * as dt from './datetime.ts'
import { expand } from './recurrence.ts'
import { swatch } from './colors.ts'
import type { CalEvent, Calendar, LaidOutOccurrence, Occurrence } from './types.ts'
import type { Local, LocalDate } from './datetime.ts'

export interface Range {
  /** Inclusive start of the window. */
  from: Local
  /** Exclusive end of the window. */
  to: Local
}

/** Length of an event in minutes; all-day events count whole days. */
export function durationMinutes(event: Pick<CalEvent, 'start' | 'end' | 'allDay'>): number {
  if (event.allDay) {
    // All-day `end` is exclusive, so a single day is end - start = 1.
    return Math.max(1, dt.diffDays(event.start, event.end)) * 1440
  }
  return Math.max(0, dt.diffMinutes(event.start, event.end))
}

/** Where an occurrence ends, given where it starts. */
function occurrenceEnd(start: Local, event: CalEvent, minutes: number): Local {
  if (event.allDay) return dt.dateOf(dt.addDays(start, Math.max(1, Math.round(minutes / 1440))))
  return dt.addMinutes(start, minutes)
}

/**
 * Every appearance of every visible event inside the window, ascending.
 *
 * Hidden calendars, deleted events and events whose calendar no longer exists
 * are dropped here rather than in each view, so no view can forget to.
 */
export function queryOccurrences(events: CalEvent[], calendars: Calendar[], range: Range): Occurrence[] {
  const byId = new Map<string, Calendar>()
  for (const c of calendars) {
    if (c.deletedAt == null) byId.set(c.id, c)
  }

  const out: Occurrence[] = []

  for (const event of events) {
    if (event.deletedAt != null) continue
    const calendar = byId.get(event.calendarId)
    if (!calendar || !calendar.visible) continue

    const minutes = durationMinutes(event)
    const starts = expand(event.start, event.rrule, {
      rangeStart: range.from,
      rangeEnd: range.to,
      exdates: event.exdates,
      durationMinutes: minutes,
    })

    const color = calendar.color
    const readOnly = calendar.readOnly || event.readOnly === true

    for (const start of starts) {
      out.push({
        key: `${event.id}:${start}`,
        eventId: event.id,
        calendarId: event.calendarId,
        title: event.title,
        location: event.location,
        description: event.description,
        start,
        end: occurrenceEnd(start, event, minutes),
        allDay: event.allDay,
        color,
        recurring: Boolean(event.rrule),
        seriesStart: event.rrule ? event.start : undefined,
        readOnly,
        reminders: event.reminders ?? [],
      })
    }
  }

  return out.sort(compareOccurrences)
}

/** All-day first, then by start, then by title — a stable, readable order. */
export function compareOccurrences(a: Occurrence, b: Occurrence): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
  if (a.start !== b.start) return a.start < b.start ? -1 : 1
  const byTitle = a.title.localeCompare(b.title, dt.getLocale())
  return byTitle !== 0 ? byTitle : a.key.localeCompare(b.key)
}

/** Occurrences that touch a given calendar day. */
export function onDate(occurrences: Occurrence[], date: LocalDate): Occurrence[] {
  return occurrences.filter((o) => {
    const start = dt.dateOf(o.start)
    // All-day `end` is exclusive; a timed event ending at 00:00 belongs to the
    // previous day, so both cases step back one day to get the last day shown.
    const lastDay = dt.dateOf(dt.addDays(o.end, exclusiveEndBackoff(o) ? -1 : 0))
    return start <= date && date <= (lastDay < start ? start : lastDay)
  })
}

function exclusiveEndBackoff(o: Occurrence): boolean {
  if (o.allDay) return true
  return dt.timeOf(o.end) === '00:00'
}

export interface SplitOccurrences {
  allDay: Occurrence[]
  timed: Occurrence[]
}

/** The all-day row and the hour grid draw from different lists. */
export function splitAllDay(occurrences: Occurrence[]): SplitOccurrences {
  const allDay: Occurrence[] = []
  const timed: Occurrence[] = []
  for (const o of occurrences) {
    // A timed event that spans more than one day also belongs in the all-day
    // row: drawing it in the hour grid would mean slicing it across columns.
    const spansDays = !o.allDay && dt.dateOf(o.start) !== dt.dateOf(o.end) && !exclusiveEndBackoff(o)
    ;(o.allDay || spansDays ? allDay : timed).push(o)
  }
  return { allDay, timed }
}

/* --------------------------------- layout --------------------------------- */

/**
 * Ceiling for `LaidOutOccurrence.z`.
 *
 * Event blocks are ordinary positioned elements in the page, so whatever the
 * view turns this into competes with every overlay in the app. Dialogs,
 * sheets and toasts sit at 30–50, so this stays an order of magnitude below
 * them: a block must never be able to cover a question the user has to answer.
 */
export const MAX_LAYOUT_Z = 20

export interface DayLayoutOptions {
  /** The day being laid out. Required: an occurrence may start the day before. */
  date: LocalDate
  dayStartHour?: number
  dayEndHour?: number
  /**
   * Visual floor, in minutes. A 10-minute event drawn to scale has no room for
   * its title, so it is drawn as if it were this long.
   */
  minMinutes?: number
}

/**
 * Pack timed occurrences into a day column.
 *
 * `top`/`height` are fractions of the visible window; `left`/`width` are
 * fractions of the column. Overlap is computed from real times, never from the
 * inflated visual height, so bumping `minMinutes` cannot change which events
 * are considered to collide.
 */
export function layoutDay(occurrences: Occurrence[], opts: DayLayoutOptions): LaidOutOccurrence[] {
  const dayStart = (opts.dayStartHour ?? 0) * 60
  const dayEnd = (opts.dayEndHour ?? 24) * 60
  const span = Math.max(1, dayEnd - dayStart)
  const minMinutes = opts.minMinutes ?? 30
  const date = opts.date

  interface Slot {
    occ: Occurrence
    startMin: number
    endMin: number
  }

  const slots: Slot[] = []
  for (const occ of occurrences) {
    if (occ.allDay) continue

    // Clip to this day. An occurrence that began yesterday starts at 00:00
    // here; one that runs past midnight ends at 24:00 here.
    const startsEarlier = dt.dateOf(occ.start) < date
    const endsLater = dt.dateOf(occ.end) > date
    const rawStart = startsEarlier ? 0 : dt.minutesOfDay(occ.start)
    const rawEnd = endsLater ? 1440 : dt.minutesOfDay(occ.end)

    const startMin = Math.max(dayStart, Math.min(dayEnd, rawStart))
    const endMin = Math.max(startMin, Math.min(dayEnd, rawEnd))
    if (startMin >= dayEnd || endMin <= dayStart) continue

    slots.push({ occ, startMin, endMin })
  }

  slots.sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin || a.occ.key.localeCompare(b.occ.key))

  const out: LaidOutOccurrence[] = []
  let order = 0

  for (const cluster of clusters(slots)) {
    const columns = assignColumns(cluster)
    // Seed the spread with 0, not 1: the highest column *index* plus one is the
    // count, so a lone event must come out as one column, not two.
    const columnCount = Math.max(0, ...columns.values()) + 1

    for (const slot of cluster) {
      const column = columns.get(slot) ?? 0
      const visualEnd = Math.max(slot.endMin, slot.startMin + minMinutes)

      let top = (slot.startMin - dayStart) / span
      let height = (visualEnd - slot.startMin) / span
      // Keep the inflated block inside the column instead of overflowing it.
      if (top + height > 1) {
        height = Math.min(height, 1)
        top = Math.max(0, 1 - height)
      }

      out.push({
        occ: slot.occ,
        top,
        height,
        left: column / columnCount,
        width: 1 / columnCount,
        // A running position, not a time.
        //
        // This used to be the minute-of-day, which the view then turned into
        // a CSS z-index — so a 14:15 event got z-index 87 and painted over
        // every dialog, sheet and toast in the app (those live at 30–50).
        // Slots are already sorted by start, so a counter keeps the same
        // "later starts on top" order while staying a small number that
        // cannot climb out of the grid. Capped in `MAX_LAYOUT_Z`.
        z: Math.min(order++, MAX_LAYOUT_Z),
      })
    }
  }

  return out
}

/** Split into groups where every member overlaps at least one other. */
function clusters<T extends { startMin: number; endMin: number }>(slots: T[]): T[][] {
  const out: T[][] = []
  let current: T[] = []
  let reach = -Infinity

  for (const slot of slots) {
    if (current.length && slot.startMin >= reach) {
      out.push(current)
      current = []
      reach = -Infinity
    }
    current.push(slot)
    reach = Math.max(reach, slot.endMin)
  }
  if (current.length) out.push(current)
  return out
}

/** Greedy column assignment: reuse the leftmost column that has freed up. */
function assignColumns<T extends { startMin: number; endMin: number }>(cluster: T[]): Map<T, number> {
  const columnEnds: number[] = []
  const assigned = new Map<T, number>()

  for (const slot of cluster) {
    let column = columnEnds.findIndex((end) => end <= slot.startMin)
    if (column === -1) {
      column = columnEnds.length
      columnEnds.push(slot.endMin)
    } else {
      columnEnds[column] = slot.endMin
    }
    assigned.set(slot, column)
  }

  return assigned
}

/* ------------------------------ month helpers ----------------------------- */

/** Occurrences grouped by day, for the month grid. */
export function groupByDate(occurrences: Occurrence[], dates: LocalDate[]): Map<LocalDate, Occurrence[]> {
  const out = new Map<LocalDate, Occurrence[]>()
  for (const date of dates) out.set(date, [])
  for (const occ of occurrences) {
    for (const date of dt.datesBetween(occ.start, lastVisibleDay(occ))) {
      const bucket = out.get(date)
      if (bucket) bucket.push(occ)
    }
  }
  return out
}

/** The last calendar day an occurrence should appear on. */
export function lastVisibleDay(occ: Occurrence): LocalDate {
  const start = dt.dateOf(occ.start)
  const end = dt.dateOf(exclusiveEndBackoff(occ) ? dt.addDays(occ.end, -1) : occ.end)
  return end < start ? start : end
}

/** Convenience for the chip colour without importing the palette everywhere. */
export function occurrenceSwatch(occ: Occurrence) {
  return swatch(occ.color)
}
