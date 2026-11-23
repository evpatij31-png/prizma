import { test } from 'node:test'
import assert from 'node:assert/strict'

import { deleteFromSeries, editSeries, isFirstOccurrence } from '../src/lib/series.ts'
import { expand, parseRule } from '../src/lib/recurrence.ts'
import type { CalEvent } from '../src/lib/types.ts'

/** A weekly Monday 10:00-10:30 meeting starting 2026-11-16. */
const weekly = (over: Partial<CalEvent> = {}): CalEvent => ({
  id: 'series-1',
  uid: 'series-1@prizma',
  updatedAt: 1,
  calendarId: 'cal-1',
  title: 'Планёрка',
  start: '2026-11-16T10:00',
  end: '2026-11-16T10:30',
  allDay: false,
  rrule: 'FREQ=WEEKLY;BYDAY=MO',
  reminders: [],
  ...over,
})

/** Occurrence starts of an event within a window. */
const starts = (e: CalEvent, from = '2026-11-01', to = '2027-02-01') =>
  expand(e.start, e.rrule, { rangeStart: from, rangeEnd: to, exdates: e.exdates })

test('a non-recurring event is just edited, whatever the scope', () => {
  const single = weekly({ rrule: undefined })
  for (const scope of ['this', 'following', 'series'] as const) {
    const { writes, deletes } = editSeries(single, single.start, { title: 'Новое' }, scope)
    assert.equal(writes.length, 1)
    assert.equal(writes[0].title, 'Новое')
    assert.deepEqual(deletes, [])
  }
})

/* --------------------------------- series -------------------------------- */

test('editing the whole series shifts every occurrence, not just one', () => {
  // Drag the third Monday from 10:00 to 11:00 and keep the series.
  const event = weekly()
  const { writes } = editSeries(event, '2026-11-30T10:00', { start: '2026-11-30T11:00', end: '2026-11-30T11:30' }, 'series')
  assert.equal(writes.length, 1)

  const updated = writes[0]
  assert.equal(updated.start, '2026-11-16T11:00', 'the series start must move by the same hour')
  assert.equal(updated.end, '2026-11-16T11:30')
  // Still every Monday, same count, just an hour later.
  assert.equal(starts(updated).length, starts(event).length)
  assert.ok(starts(updated).every((s) => s.endsWith('T11:00')))
})

test('editing the series can also move it to another weekday', () => {
  const event = weekly()
  const { writes } = editSeries(event, '2026-11-30T10:00', { start: '2026-12-01T10:00', end: '2026-12-01T10:30' }, 'series')
  assert.equal(writes[0].start, '2026-11-17T10:00')
})

test('a series edit with no time change leaves the times alone', () => {
  const event = weekly()
  const { writes } = editSeries(event, '2026-11-30T10:00', { title: 'Переименована' }, 'series')
  assert.equal(writes[0].start, event.start)
  assert.equal(writes[0].end, event.end)
  assert.equal(writes[0].title, 'Переименована')
})

/* ---------------------------------- this --------------------------------- */

test('editing one occurrence excludes it and creates a detached event', () => {
  const event = weekly()
  const { writes } = editSeries(
    event,
    '2026-11-30T10:00',
    { start: '2026-11-30T15:00', end: '2026-11-30T16:00' },
    'this',
  )
  assert.equal(writes.length, 2)
  const [series, detached] = writes

  assert.deepEqual(series.exdates, ['2026-11-30T10:00'])
  assert.equal(series.start, event.start, 'the series itself must not move')

  assert.equal(detached.rrule, undefined, 'a detached instance is not a series')
  assert.equal(detached.recurringEventId, event.id)
  assert.equal(detached.originalStart, '2026-11-30T10:00')
  assert.equal(detached.start, '2026-11-30T15:00')
  assert.equal(detached.end, '2026-11-30T16:00')
  assert.equal(detached.id, '', 'a new record, so the store assigns the id')
})

test('the excluded occurrence disappears from the series and the others stay', () => {
  const event = weekly()
  const before = starts(event)
  const { writes } = editSeries(event, '2026-11-30T10:00', { title: 'Особая' }, 'this')
  const after = starts(writes[0])

  assert.equal(after.length, before.length - 1)
  assert.ok(!after.includes('2026-11-30T10:00'))
  assert.ok(after.includes('2026-11-23T10:00'))
  assert.ok(after.includes('2026-12-07T10:00'))
})

test('editing one occurrence without moving it keeps that slot time', () => {
  const event = weekly()
  const { writes } = editSeries(event, '2026-11-30T10:00', { title: 'Особая' }, 'this')
  assert.equal(writes[1].start, '2026-11-30T10:00')
  assert.equal(writes[1].end, '2026-11-30T10:30')
  assert.equal(writes[1].title, 'Особая')
})

test('exdates accumulate rather than replace', () => {
  const event = weekly({ exdates: ['2026-11-23T10:00'] })
  const { writes } = editSeries(event, '2026-11-30T10:00', { title: 'x' }, 'this')
  assert.deepEqual(writes[0].exdates, ['2026-11-23T10:00', '2026-11-30T10:00'])
})

/* -------------------------------- following ------------------------------- */

test('splitting a series ends the first half and starts a second', () => {
  const event = weekly()
  const { writes } = editSeries(
    event,
    '2026-11-30T10:00',
    { start: '2026-11-30T15:00', end: '2026-11-30T16:00' },
    'following',
  )
  assert.equal(writes.length, 2)
  const [head, tail] = writes

  const headStarts = starts(head)
  assert.deepEqual(headStarts, ['2026-11-16T10:00', '2026-11-23T10:00'])
  assert.ok(parseRule(head.rrule!)?.until, 'the first half must be capped')

  assert.equal(tail.start, '2026-11-30T15:00')
  assert.equal(tail.end, '2026-11-30T16:00')
  assert.equal(tail.id, '')
  assert.ok(starts(tail).every((s) => s >= '2026-11-30'))
  assert.ok(starts(tail).every((s) => s.endsWith('T15:00')))
})

test('no occurrence is lost or duplicated across a split', () => {
  const event = weekly()
  const before = starts(event)
  const { writes } = editSeries(event, '2026-11-30T10:00', { title: 'x' }, 'following')
  const after = [...starts(writes[0]), ...starts(writes[1])].sort()

  assert.deepEqual(after, before.sort(), 'the union of both halves must equal the original')
})

test('splitting at the very first occurrence edits the series instead', () => {
  // A split there would leave an empty stub behind.
  const event = weekly()
  const { writes } = editSeries(
    event,
    '2026-11-16T10:00',
    { start: '2026-11-16T12:00', end: '2026-11-16T12:30' },
    'following',
  )
  assert.equal(writes.length, 1)
  assert.equal(writes[0].id, event.id)
  assert.equal(writes[0].start, '2026-11-16T12:00')
})

test('a COUNT is divided between the halves, not copied to both', () => {
  // Copying COUNT=10 to both halves would turn 10 meetings into 12.
  const event = weekly({ rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=10' })
  const before = starts(event)
  assert.equal(before.length, 10)

  const { writes } = editSeries(event, '2026-12-07T10:00', { title: 'x' }, 'following')
  const headCount = starts(writes[0]).length
  const tailCount = starts(writes[1]).length

  assert.equal(headCount + tailCount, 10, `split produced ${headCount} + ${tailCount}`)
  assert.equal(headCount, 3)
})

test('a split series keeps its exdates on the correct side', () => {
  const event = weekly({ exdates: ['2026-11-23T10:00', '2026-12-14T10:00'] })
  const { writes } = editSeries(event, '2026-11-30T10:00', { title: 'x' }, 'following')
  assert.deepEqual(writes[0].exdates, ['2026-11-23T10:00'])
  assert.deepEqual(writes[1].exdates, ['2026-12-14T10:00'])
})

/* --------------------------------- delete -------------------------------- */

test('deleting one occurrence only excludes it', () => {
  const event = weekly()
  const { writes, deletes } = deleteFromSeries(event, '2026-11-30T10:00', 'this')
  assert.deepEqual(deletes, [])
  assert.deepEqual(writes[0].exdates, ['2026-11-30T10:00'])
  assert.ok(!starts(writes[0]).includes('2026-11-30T10:00'))
})

test('deleting this and following caps the series', () => {
  const event = weekly()
  const { writes, deletes } = deleteFromSeries(event, '2026-11-30T10:00', 'following')
  assert.deepEqual(deletes, [])
  assert.deepEqual(starts(writes[0]), ['2026-11-16T10:00', '2026-11-23T10:00'])
})

test('deleting this and following from the first occurrence removes the series', () => {
  const event = weekly()
  const { writes, deletes } = deleteFromSeries(event, '2026-11-16T10:00', 'following')
  assert.deepEqual(writes, [])
  assert.deepEqual(deletes, [event.id])
})

test('deleting the series removes it outright', () => {
  const event = weekly()
  assert.deepEqual(deleteFromSeries(event, '2026-11-30T10:00', 'series'), { writes: [], deletes: [event.id] })
})

test('deleting a non-recurring event removes it whatever the scope', () => {
  const single = weekly({ rrule: undefined })
  assert.deepEqual(deleteFromSeries(single, single.start, 'this'), { writes: [], deletes: [single.id] })
})

test('isFirstOccurrence compares the occurrence to the series start', () => {
  const event = weekly()
  assert.equal(isFirstOccurrence(event, '2026-11-16T10:00'), true)
  assert.equal(isFirstOccurrence(event, '2026-11-23T10:00'), false)
})
