/**
 * Editing one occurrence, the rest of a series, or all of it.
 *
 * This is the part of a calendar that is easy to get subtly wrong and hard to
 * notice: an edit that silently drops the other 51 weekly meetings, or a split
 * that quietly adds occurrences because COUNT was copied to both halves. Every
 * rule here is therefore a pure function returning the records to write, with
 * the store doing nothing but persisting them.
 */

import * as dt from './datetime.ts'
import { expand, parseRule, serializeRule } from './recurrence.ts'
import type { CalEvent } from './types.ts'
import type { Local } from './datetime.ts'

export type SeriesScope = 'this' | 'following' | 'series'

export const SCOPE_LABELS: Record<SeriesScope, string> = {
  this: 'Только это вхождение',
  following: 'Это и все следующие',
  series: 'Всю серию',
}

/** The fields a drag or an editor can change. */
export type EventChanges = Partial<
  Pick<CalEvent, 'start' | 'end' | 'title' | 'description' | 'location' | 'allDay' | 'calendarId' | 'reminders'>
>

export interface SeriesWrite {
  /** Records to put, in order. A blank id means "create". */
  writes: CalEvent[]
  /** Ids to tombstone. */
  deletes: string[]
}

const blank = { id: '', uid: '', updatedAt: 0 }

/** Is this occurrence the very first one of its series? */
export function isFirstOccurrence(event: CalEvent, occurrenceStart: Local): boolean {
  return dt.dateOf(event.start) === dt.dateOf(occurrenceStart) && dt.timeOf(event.start) === dt.timeOf(occurrenceStart)
}

/**
 * Apply `changes` to a series at `occurrenceStart` with the given scope.
 *
 * For `series`, a time change is applied as a *shift*: dragging the third
 * Monday from 10:00 to 11:00 moves every Monday by an hour, rather than
 * dropping the whole series onto that one date.
 */
export function editSeries(
  event: CalEvent,
  occurrenceStart: Local,
  changes: EventChanges,
  scope: SeriesScope,
): SeriesWrite {
  if (!event.rrule) {
    return { writes: [{ ...event, ...changes }], deletes: [] }
  }

  // Editing the first occurrence "and following" is the whole series; splitting
  // would leave an empty stub behind.
  const effective = scope === 'following' && isFirstOccurrence(event, occurrenceStart) ? 'series' : scope

  switch (effective) {
    case 'series':
      return { writes: [applyShift(event, occurrenceStart, changes)], deletes: [] }

    case 'this': {
      const exdates = [...(event.exdates ?? []), occurrenceStart]
      const detached: CalEvent = {
        ...event,
        ...blank,
        // A detached instance is a normal single event that remembers where it
        // came from, so a later "edit the series" can still find its children.
        rrule: undefined,
        exdates: undefined,
        recurringEventId: event.id,
        originalStart: occurrenceStart,
        start: changes.start ?? occurrenceStart,
        end: changes.end ?? shiftEnd(event, occurrenceStart),
        ...withoutTimes(changes),
      }
      return { writes: [{ ...event, exdates }, detached], deletes: [] }
    }

    case 'following': {
      const tail = splitSeries(event, occurrenceStart)
      return {
        writes: [tail.head, { ...tail.tail, ...applyChangesTo(tail.tail, occurrenceStart, changes) }],
        deletes: [],
      }
    }
  }
}

/** Remove one occurrence, the rest of a series, or the whole thing. */
export function deleteFromSeries(event: CalEvent, occurrenceStart: Local, scope: SeriesScope): SeriesWrite {
  if (!event.rrule) return { writes: [], deletes: [event.id] }

  switch (scope) {
    case 'this':
      return { writes: [{ ...event, exdates: [...(event.exdates ?? []), occurrenceStart] }], deletes: [] }

    case 'following': {
      if (isFirstOccurrence(event, occurrenceStart)) return { writes: [], deletes: [event.id] }
      const { head } = splitSeries(event, occurrenceStart)
      return { writes: [head], deletes: [] }
    }

    case 'series':
      return { writes: [], deletes: [event.id] }
  }
}

/* -------------------------------- internals ------------------------------- */

/** The end of the occurrence that starts at `occurrenceStart`. */
function shiftEnd(event: CalEvent, occurrenceStart: Local): Local {
  if (event.allDay) {
    const days = Math.max(1, dt.diffDays(event.start, event.end))
    return dt.dateOf(dt.addDays(occurrenceStart, days))
  }
  return dt.addMinutes(occurrenceStart, dt.diffMinutes(event.start, event.end))
}

function withoutTimes(changes: EventChanges): EventChanges {
  const { start: _s, end: _e, ...rest } = changes
  return rest
}

/**
 * Apply changes to a series record, translating a time change on one
 * occurrence into a shift of the whole series.
 */
function applyShift(event: CalEvent, occurrenceStart: Local, changes: EventChanges): CalEvent {
  return { ...event, ...applyChangesTo(event, occurrenceStart, changes) }
}

function applyChangesTo(event: CalEvent, occurrenceStart: Local, changes: EventChanges): Partial<CalEvent> {
  const rest = withoutTimes(changes)
  if (!changes.start) return rest

  const dayDelta = dt.diffDays(occurrenceStart, changes.start)
  const minuteDelta = dt.hasTime(occurrenceStart) && dt.hasTime(changes.start)
    ? dt.minutesOfDay(changes.start) - dt.minutesOfDay(occurrenceStart)
    : 0

  const start = dt.addMinutes(dt.addDays(event.start, dayDelta), minuteDelta)
  // The new length comes from the dragged occurrence, not the old series.
  const duration = changes.end ? dt.diffMinutes(changes.start, changes.end) : dt.diffMinutes(event.start, event.end)

  return { ...rest, start, end: dt.addMinutes(start, duration) }
}

/**
 * Cut a series in two just before `occurrenceStart`.
 *
 * The head gets an UNTIL; the tail starts at the split. When the original had
 * a COUNT, it is divided between the halves — copying it to both would
 * silently create extra occurrences, which is the bug this function exists to
 * avoid.
 */
function splitSeries(event: CalEvent, occurrenceStart: Local): { head: CalEvent; tail: CalEvent } {
  const rule = parseRule(event.rrule ?? '')
  if (!rule) return { head: event, tail: event }

  const before = expand(event.start, rule, {
    rangeEnd: occurrenceStart,
    exdates: event.exdates,
    limit: 2000,
  }).length

  const headRule = { ...rule }
  const tailRule = { ...rule }

  if (rule.count != null) {
    headRule.count = before
    tailRule.count = Math.max(1, rule.count - before)
    delete headRule.until
  } else {
    // UNTIL is inclusive, so stop one minute short of the split.
    headRule.until = dt.hasTime(occurrenceStart) ? dt.addMinutes(occurrenceStart, -1) : dt.dateOf(dt.addDays(occurrenceStart, -1))
    delete headRule.count
  }

  const head: CalEvent = {
    ...event,
    rrule: serializeRule(headRule),
    exdates: event.exdates?.filter((d) => d < occurrenceStart),
  }
  const tail: CalEvent = {
    ...event,
    ...blank,
    rrule: serializeRule(tailRule),
    start: occurrenceStart,
    end: shiftEnd(event, occurrenceStart),
    exdates: event.exdates?.filter((d) => d >= occurrenceStart),
    recurringEventId: undefined,
    originalStart: undefined,
  }

  return { head, tail }
}
