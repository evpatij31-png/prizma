import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_LAYOUT_Z,
  durationMinutes,
  groupByDate,
  layoutDay,
  lastVisibleDay,
  onDate,
  queryOccurrences,
  splitAllDay,
} from '../src/lib/occurrences.ts'
import { stats } from '../src/lib/recurrence.ts'
import type { CalEvent, Calendar, Occurrence } from '../src/lib/types.ts'

const blank = { uid: 'u', updatedAt: 1 }

const cal = (over: Partial<Calendar> = {}): Calendar => ({
  ...blank,
  id: 'cal-1',
  name: 'Личное',
  color: 'violet',
  visible: true,
  readOnly: false,
  kind: 'local',
  order: 0,
  ...over,
})

let n = 0
const ev = (over: Partial<CalEvent> = {}): CalEvent => ({
  ...blank,
  id: `e${++n}`,
  calendarId: 'cal-1',
  title: 'Событие',
  start: '2026-11-22T09:00',
  end: '2026-11-22T10:00',
  allDay: false,
  reminders: [],
  ...over,
})

const NOVEMBER = { from: '2026-11-01', to: '2026-12-01' }

/* ------------------------------ durations ------------------------------- */

test('duration counts whole days for an all-day event', () => {
  // All-day end is exclusive: one day is start -> start+1.
  assert.equal(durationMinutes({ start: '2026-11-22', end: '2026-11-23', allDay: true }), 1440)
  assert.equal(durationMinutes({ start: '2026-11-22', end: '2026-11-25', allDay: true }), 3 * 1440)
  // A malformed zero-length all-day event still occupies its day.
  assert.equal(durationMinutes({ start: '2026-11-22', end: '2026-11-22', allDay: true }), 1440)
})

test('duration is minutes for a timed event', () => {
  assert.equal(durationMinutes({ start: '2026-11-22T09:00', end: '2026-11-22T10:30', allDay: false }), 90)
  assert.equal(durationMinutes({ start: '2026-11-22T09:00', end: '2026-11-22T09:00', allDay: false }), 0)
})

/* ---------------------------- queryOccurrences --------------------------- */

test('a single event yields exactly one occurrence', () => {
  const out = queryOccurrences([ev()], [cal()], NOVEMBER)
  assert.equal(out.length, 1)
  assert.equal(out[0].start, '2026-11-22T09:00')
  assert.equal(out[0].end, '2026-11-22T10:00')
  assert.equal(out[0].recurring, false)
  assert.equal(out[0].color, 'violet')
})

test('a daily series yields one occurrence per day in the window', () => {
  const out = queryOccurrences([ev({ start: '2026-11-01T09:00', end: '2026-11-01T10:00', rrule: 'FREQ=DAILY' })], [cal()], NOVEMBER)
  assert.equal(out.length, 30) // November has 30 days
  assert.equal(out[0].start, '2026-11-01T09:00')
  assert.equal(out.at(-1)?.start, '2026-11-30T09:00')
  assert.ok(out.every((o) => o.recurring))
  assert.ok(out.every((o) => o.seriesStart === '2026-11-01T09:00'))
})

test('occurrence keys are unique and stable', () => {
  const out = queryOccurrences([ev({ rrule: 'FREQ=DAILY' })], [cal()], NOVEMBER)
  assert.equal(new Set(out.map((o) => o.key)).size, out.length)
  assert.equal(out[0].key, `${out[0].eventId}:${out[0].start}`)
})

test('events of a hidden calendar are dropped', () => {
  assert.deepEqual(queryOccurrences([ev()], [cal({ visible: false })], NOVEMBER), [])
})

test('deleted events and events of a deleted calendar are dropped', () => {
  assert.deepEqual(queryOccurrences([ev({ deletedAt: Date.now() })], [cal()], NOVEMBER), [])
  assert.deepEqual(queryOccurrences([ev()], [cal({ deletedAt: Date.now() })], NOVEMBER), [])
})

test('an event whose calendar is missing is dropped rather than crashing', () => {
  assert.deepEqual(queryOccurrences([ev({ calendarId: 'gone' })], [cal()], NOVEMBER), [])
})

test('an occurrence starting before the window but ending inside it is kept', () => {
  const out = queryOccurrences(
    [ev({ start: '2026-10-30T09:00', end: '2026-11-02T10:00' })],
    [cal()],
    NOVEMBER,
  )
  assert.equal(out.length, 1)
  assert.equal(out[0].start, '2026-10-30T09:00')
})

test('a read-only calendar marks its occurrences read-only', () => {
  const out = queryOccurrences([ev()], [cal({ readOnly: true })], NOVEMBER)
  assert.equal(out[0].readOnly, true)
})

test('EXDATE removes the excluded occurrence from the series', () => {
  const out = queryOccurrences(
    [ev({ start: '2026-11-01T09:00', end: '2026-11-01T10:00', rrule: 'FREQ=DAILY', exdates: ['2026-11-03T09:00'] })],
    [cal()],
    NOVEMBER,
  )
  assert.equal(out.length, 29)
  assert.ok(!out.some((o) => o.start === '2026-11-03T09:00'))
})

test('all-day occurrences sort before timed ones on the same day', () => {
  const out = queryOccurrences(
    [
      ev({ title: 'встреча', start: '2026-11-22T09:00', end: '2026-11-22T10:00' }),
      ev({ title: 'отпуск', start: '2026-11-22', end: '2026-11-23', allDay: true }),
    ],
    [cal()],
    NOVEMBER,
  )
  assert.deepEqual(out.map((o) => o.title), ['отпуск', 'встреча'])
})

test('occurrences from several calendars carry their own colour', () => {
  const out = queryOccurrences(
    [ev({ calendarId: 'cal-1' }), ev({ calendarId: 'cal-2', start: '2026-11-22T11:00', end: '2026-11-22T12:00' })],
    [cal(), cal({ id: 'cal-2', color: 'amber' })],
    NOVEMBER,
  )
  assert.deepEqual(out.map((o) => o.color), ['violet', 'amber'])
})

test('expanding a long-running series into one month stays cheap', () => {
  // Criterion 11: proof the fast-forward works. Without it, a daily series
  // from 2000 costs ~9800 candidates to draw a month of 2026.
  stats.candidatesExamined = 0
  const out = queryOccurrences(
    [ev({ start: '2000-01-01T09:00', end: '2000-01-01T10:00', rrule: 'FREQ=DAILY' })],
    [cal()],
    NOVEMBER,
  )
  assert.equal(out.length, 30)
  assert.ok(
    stats.candidatesExamined < 100,
    `examined ${stats.candidatesExamined} candidates, expected under 100`,
  )
})

/* --------------------------------- layout -------------------------------- */

const occ = (start: string, end: string, over: Partial<Occurrence> = {}): Occurrence => ({
  key: `${start}-${end}`,
  eventId: 'e',
  calendarId: 'cal-1',
  title: 'Событие',
  start,
  end,
  allDay: false,
  color: 'violet',
  recurring: false,
  readOnly: false,
  reminders: [],
  ...over,
})

const DAY = { date: '2026-11-22', dayStartHour: 0, dayEndHour: 24 }

test('two fully overlapping events split the column in half', () => {
  const out = layoutDay(
    [occ('2026-11-22T09:00', '2026-11-22T10:00'), occ('2026-11-22T09:00', '2026-11-22T10:00', { key: 'b' })],
    DAY,
  )
  assert.equal(out.length, 2)
  assert.ok(out.every((l) => l.width === 0.5))
  assert.deepEqual(out.map((l) => l.left).sort(), [0, 0.5])
})

test('two events that do not overlap each take the full width', () => {
  const out = layoutDay(
    [occ('2026-11-22T09:00', '2026-11-22T10:00'), occ('2026-11-22T11:00', '2026-11-22T12:00')],
    DAY,
  )
  assert.ok(out.every((l) => l.width === 1 && l.left === 0))
})

test('an event ending exactly when the next begins does not count as overlapping', () => {
  const out = layoutDay(
    [occ('2026-11-22T09:00', '2026-11-22T10:00'), occ('2026-11-22T10:00', '2026-11-22T11:00')],
    DAY,
  )
  assert.ok(out.every((l) => l.width === 1))
})

test('three mutually overlapping events split into thirds', () => {
  const out = layoutDay(
    [
      occ('2026-11-22T09:00', '2026-11-22T12:00', { key: 'a' }),
      occ('2026-11-22T09:30', '2026-11-22T12:00', { key: 'b' }),
      occ('2026-11-22T10:00', '2026-11-22T12:00', { key: 'c' }),
    ],
    DAY,
  )
  assert.ok(out.every((l) => Math.abs(l.width - 1 / 3) < 1e-9))
  assert.equal(new Set(out.map((l) => l.left)).size, 3)
})

test('a freed column is reused instead of narrowing the whole cluster', () => {
  // A and B overlap; C starts after A ends, so it belongs in A's column and
  // the cluster stays two wide rather than three.
  const out = layoutDay(
    [
      occ('2026-11-22T09:00', '2026-11-22T10:00', { key: 'a' }),
      occ('2026-11-22T09:30', '2026-11-22T12:00', { key: 'b' }),
      occ('2026-11-22T10:00', '2026-11-22T11:00', { key: 'c' }),
    ],
    DAY,
  )
  assert.ok(out.every((l) => l.width === 0.5))
})

test('a short event is drawn at the 30-minute minimum', () => {
  const out = layoutDay([occ('2026-11-22T09:00', '2026-11-22T09:10')], DAY)
  // 30 minutes out of a 24-hour window.
  assert.ok(Math.abs(out[0].height - 30 / 1440) < 1e-9)
})

test('the visual minimum does not change who overlaps whom', () => {
  // Two 10-minute events 20 minutes apart would collide if overlap were
  // judged on the inflated height. They must not.
  const out = layoutDay(
    [occ('2026-11-22T09:00', '2026-11-22T09:10'), occ('2026-11-22T09:20', '2026-11-22T09:30')],
    DAY,
  )
  assert.ok(out.every((l) => l.width === 1))
})

test('an inflated block near the end of the window stays inside it', () => {
  const out = layoutDay([occ('2026-11-22T23:55', '2026-11-23T00:00')], DAY)
  assert.ok(out[0].top + out[0].height <= 1 + 1e-9)
  assert.ok(out[0].height > 0)
})

test('top and height are fractions of the visible window, not the whole day', () => {
  const out = layoutDay([occ('2026-11-22T12:00', '2026-11-22T13:00')], {
    date: '2026-11-22',
    dayStartHour: 8,
    dayEndHour: 20,
  })
  // 12:00 is a third of the way through an 08:00-20:00 window.
  assert.ok(Math.abs(out[0].top - 1 / 3) < 1e-9)
  assert.ok(Math.abs(out[0].height - 1 / 12) < 1e-9)
})

test('an event outside the visible hours is dropped from the grid', () => {
  const out = layoutDay([occ('2026-11-22T03:00', '2026-11-22T04:00')], {
    date: '2026-11-22',
    dayStartHour: 8,
    dayEndHour: 20,
  })
  assert.deepEqual(out, [])
})

test('an event running past midnight is clipped to the end of the day', () => {
  const out = layoutDay([occ('2026-11-22T22:00', '2026-11-23T02:00')], DAY)
  assert.ok(Math.abs(out[0].top - 22 / 24) < 1e-9)
  assert.ok(Math.abs(out[0].top + out[0].height - 1) < 1e-9)
})

test('an event that began yesterday starts at the top of today', () => {
  const out = layoutDay([occ('2026-11-21T22:00', '2026-11-22T02:00')], DAY)
  assert.equal(out[0].top, 0)
  assert.ok(Math.abs(out[0].height - 2 / 24) < 1e-9)
})

test('all-day occurrences never enter the hour grid', () => {
  assert.deepEqual(layoutDay([occ('2026-11-22', '2026-11-23', { allDay: true })], DAY), [])
})

test('stacking order never climbs into the overlay range', () => {
  // Found by the user, in the app: `z` used to be the minute-of-day, which
  // the view turned into a CSS z-index — so a 14:15 event got 87 and painted
  // over the "change recurring event?" dialog, the mobile editor sheet, the
  // search panel and every toast. Those live at 30-50.
  const everyHalfHour = Array.from({ length: 40 }, (_, i) => {
    const minutes = 8 * 60 + i * 20
    const at = (m: number) => `2026-11-22T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    return occ(at(minutes), at(minutes + 90), { key: `k${i}` })
  })

  const out = layoutDay(everyHalfHour, { date: '2026-11-22', dayStartHour: 0, dayEndHour: 24 })
  assert.ok(out.length > 20, 'the sample must be big enough to overflow a small ceiling')
  for (const l of out) {
    assert.ok(l.z <= MAX_LAYOUT_Z, `z of ${l.z} would compete with dialogs`)
    assert.ok(l.z >= 0)
  }
  // And the cap must be well clear of the lowest overlay in the app.
  assert.ok(MAX_LAYOUT_Z < 30)
})

test('later events stack above earlier ones', () => {
  const out = layoutDay(
    [occ('2026-11-22T09:00', '2026-11-22T17:00', { key: 'long' }), occ('2026-11-22T13:00', '2026-11-22T14:00', { key: 'short' })],
    DAY,
  )
  const long = out.find((l) => l.occ.key === 'long')!
  const short = out.find((l) => l.occ.key === 'short')!
  assert.ok(short.z > long.z)
})

/* -------------------------------- grouping ------------------------------- */

test('splitAllDay separates the all-day row from the hour grid', () => {
  const { allDay, timed } = splitAllDay([
    occ('2026-11-22T09:00', '2026-11-22T10:00'),
    occ('2026-11-22', '2026-11-23', { allDay: true, key: 'ad' }),
    // A timed event spanning two days belongs in the all-day row.
    occ('2026-11-22T22:00', '2026-11-24T02:00', { key: 'span' }),
  ])
  assert.deepEqual(allDay.map((o) => o.key).sort(), ['ad', 'span'])
  assert.equal(timed.length, 1)
})

test('a timed event ending exactly at midnight stays in the hour grid', () => {
  const { allDay, timed } = splitAllDay([occ('2026-11-22T22:00', '2026-11-23T00:00')])
  assert.deepEqual(allDay, [])
  assert.equal(timed.length, 1)
})

test('onDate finds every day a multi-day occurrence touches', () => {
  const trip = occ('2026-11-20', '2026-11-23', { allDay: true })
  assert.equal(onDate([trip], '2026-11-20').length, 1)
  assert.equal(onDate([trip], '2026-11-22').length, 1)
  // End is exclusive, so the 23rd is not part of the trip.
  assert.equal(onDate([trip], '2026-11-23').length, 0)
  assert.equal(onDate([trip], '2026-11-19').length, 0)
})

test('lastVisibleDay backs off the exclusive end', () => {
  assert.equal(lastVisibleDay(occ('2026-11-20', '2026-11-23', { allDay: true })), '2026-11-22')
  assert.equal(lastVisibleDay(occ('2026-11-22T09:00', '2026-11-22T10:00')), '2026-11-22')
  assert.equal(lastVisibleDay(occ('2026-11-22T22:00', '2026-11-23T00:00')), '2026-11-22')
})

test('groupByDate buckets occurrences into the days of a grid', () => {
  const dates = ['2026-11-21', '2026-11-22', '2026-11-23']
  const grouped = groupByDate(
    [
      occ('2026-11-22T09:00', '2026-11-22T10:00', { key: 'one-day' }),
      occ('2026-11-21', '2026-11-24', { allDay: true, key: 'trip' }),
    ],
    dates,
  )
  assert.deepEqual(grouped.get('2026-11-21')?.map((o) => o.key), ['trip'])
  assert.deepEqual(grouped.get('2026-11-22')?.map((o) => o.key).sort(), ['one-day', 'trip'])
  assert.deepEqual(grouped.get('2026-11-23')?.map((o) => o.key), ['trip'])
})

test('groupByDate ignores occurrences outside the grid', () => {
  const grouped = groupByDate([occ('2026-12-25T09:00', '2026-12-25T10:00')], ['2026-11-22'])
  assert.deepEqual(grouped.get('2026-11-22'), [])
})
