import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  HOUR_PX,
  allDayRowCount,
  gridHeight,
  hourLabels,
  layoutAllDay,
  minutesAt,
  offsetOf,
} from '../src/components/week/grid.ts'
import type { Occurrence } from '../src/lib/types.ts'

const DAY = { dayStartHour: 8, dayEndHour: 20, snapMinutes: 15 }

const occ = (start: string, end: string, over: Partial<Occurrence> = {}): Occurrence => ({
  key: `${start}|${end}`,
  eventId: 'e',
  calendarId: 'c',
  title: 'Событие',
  start,
  end,
  allDay: true,
  color: 'violet',
  recurring: false,
  readOnly: false,
  reminders: [],
  ...over,
})

const WEEK = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']

test('a pointer at the top of the grid is the first visible hour', () => {
  assert.equal(minutesAt(0, DAY), 8 * 60)
})

test('a pointer maps to minutes and snaps to the step', () => {
  // One hour down is 09:00.
  assert.equal(minutesAt(HOUR_PX, DAY), 9 * 60)
  // 10 px below that is 09:10 raw, which snaps to 09:15.
  assert.equal(minutesAt(HOUR_PX + 10, DAY), 9 * 60 + 15)
  // 3 px is 09:03 raw, which snaps back to 09:00.
  assert.equal(minutesAt(HOUR_PX + 3, DAY), 9 * 60)
})

test('a pointer dragged off either end is clamped to the visible hours', () => {
  assert.equal(minutesAt(-500, DAY), 8 * 60)
  assert.equal(minutesAt(99_999, DAY), 20 * 60)
})

test('a different snap step is honoured', () => {
  assert.equal(minutesAt(HOUR_PX + 10, { ...DAY, snapMinutes: 30 }), 9 * 60)
  assert.equal(minutesAt(HOUR_PX + 20, { ...DAY, snapMinutes: 30 }), 9 * 60 + 30)
  assert.equal(minutesAt(HOUR_PX + 10, { ...DAY, snapMinutes: 5 }), 9 * 60 + 10)
})

test('offsetOf is the inverse of minutesAt', () => {
  for (const minutes of [8 * 60, 9 * 60 + 15, 13 * 60 + 45, 19 * 60]) {
    assert.equal(minutesAt(offsetOf(minutes, DAY.dayStartHour), DAY), minutes)
  }
})

test('the grid is as tall as the visible hours', () => {
  assert.equal(gridHeight(8, 20), 12 * HOUR_PX)
  // A nonsensical range must not produce a zero-height grid.
  assert.ok(gridHeight(20, 8) > 0)
})

test('hour labels cover every visible hour, end exclusive', () => {
  const labels = hourLabels(8, 20)
  assert.equal(labels.length, 12)
  assert.equal(labels[0].label, '08:00')
  assert.equal(labels.at(-1)?.label, '19:00')
})

/* ------------------------------ all-day bars ------------------------------ */

test('a one-day item is a single-column bar', () => {
  const [bar] = layoutAllDay([occ('2026-11-18', '2026-11-19')], WEEK)
  assert.equal(bar.startIndex, 2)
  assert.equal(bar.endIndex, 2)
  assert.equal(bar.row, 0)
})

test('a multi-day item spans the columns it covers, end exclusive', () => {
  // Saturday + Sunday: stored end is Monday, so the bar must stop at Sunday.
  const [bar] = layoutAllDay([occ('2026-11-21', '2026-11-23')], WEEK)
  assert.equal(bar.startIndex, 5)
  assert.equal(bar.endIndex, 6)
})

test('an item that began before the week is clipped to the left edge', () => {
  const [bar] = layoutAllDay([occ('2026-11-10', '2026-11-18')], WEEK)
  assert.equal(bar.startIndex, 0)
  assert.equal(bar.endIndex, 1)
})

test('an item running past the week is clipped to the right edge', () => {
  const [bar] = layoutAllDay([occ('2026-11-20', '2026-12-05')], WEEK)
  assert.equal(bar.startIndex, 4)
  assert.equal(bar.endIndex, 6)
})

test('an item entirely outside the week is dropped', () => {
  assert.deepEqual(layoutAllDay([occ('2026-10-01', '2026-10-05')], WEEK), [])
  assert.deepEqual(layoutAllDay([occ('2026-12-01', '2026-12-05')], WEEK), [])
})

test('overlapping bars are stacked on separate rows', () => {
  const bars = layoutAllDay(
    [occ('2026-11-16', '2026-11-20', { key: 'a' }), occ('2026-11-18', '2026-11-23', { key: 'b' })],
    WEEK,
  )
  assert.equal(allDayRowCount(bars), 2)
  assert.equal(new Set(bars.map((b) => b.row)).size, 2)
})

test('bars that do not overlap share a row', () => {
  const bars = layoutAllDay(
    [occ('2026-11-16', '2026-11-17', { key: 'a' }), occ('2026-11-20', '2026-11-21', { key: 'b' })],
    WEEK,
  )
  assert.equal(allDayRowCount(bars), 1)
  assert.ok(bars.every((b) => b.row === 0))
})

test('the longest bar takes the top row', () => {
  const bars = layoutAllDay(
    [occ('2026-11-18', '2026-11-19', { key: 'short' }), occ('2026-11-16', '2026-11-23', { key: 'long' })],
    WEEK,
  )
  assert.equal(bars.find((b) => b.occ.key === 'long')?.row, 0)
  assert.equal(bars.find((b) => b.occ.key === 'short')?.row, 1)
})

test('an empty week produces no bars and no rows', () => {
  assert.deepEqual(layoutAllDay([], WEEK), [])
  assert.equal(allDayRowCount([]), 0)
  assert.deepEqual(layoutAllDay([occ('2026-11-18', '2026-11-19')], []), [])
})

test('a single-day view packs bars into one column', () => {
  const bars = layoutAllDay([occ('2026-11-20', '2026-12-05')], ['2026-11-20'])
  assert.equal(bars.length, 1)
  assert.equal(bars[0].startIndex, 0)
  assert.equal(bars[0].endIndex, 0)
})
