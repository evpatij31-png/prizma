import { test } from 'node:test'
import assert from 'node:assert/strict'

import { covers, inCursorMonth, loadRange, stepCursor, titleFor, visibleRange, weekNumber } from '../src/lib/view.ts'
import * as dt from '../src/lib/datetime.ts'

test('the month window is the whole 6x7 grid, not just the month', () => {
  // November 2026 starts on a Sunday, so a Monday-first grid opens in October.
  const r = visibleRange('month', '2026-11-15', 1)
  assert.equal(r.from, '2026-10-26')
  assert.equal(dt.diffDays(r.from, r.to), 42)
})

test('the month window follows the week start', () => {
  const monday = visibleRange('month', '2026-11-15', 1)
  const sunday = visibleRange('month', '2026-11-15', 0)
  assert.notEqual(monday.from, sunday.from)
  assert.equal(dt.weekday(monday.from), 1)
  assert.equal(dt.weekday(sunday.from), 0)
})

test('the week window is seven days, half-open', () => {
  const r = visibleRange('week', '2026-11-22', 1)
  assert.equal(dt.diffDays(r.from, r.to), 7)
  assert.equal(dt.weekday(r.from), 1)
  // 2026-11-22 is a Sunday, so a Monday-first week starts on the 16th.
  assert.equal(r.from, '2026-11-16')
})

test('the day window is a single day', () => {
  assert.deepEqual(visibleRange('day', '2026-11-22'), { from: '2026-11-22', to: '2026-11-23' })
})

test('the agenda looks forward, never back', () => {
  const r = visibleRange('agenda', '2026-11-22')
  assert.equal(r.from, '2026-11-22')
  assert.ok(r.to > r.from)
})

test('the load window pads the visible one on both sides', () => {
  const visible = visibleRange('month', '2026-11-15', 1)
  const load = loadRange(visible)
  assert.ok(load.from < visible.from)
  assert.ok(load.to > visible.to)
  assert.ok(covers(load, visible))
})

test('paging one month stays inside the already-loaded window', () => {
  // This is the whole point of the padding: no refetch while flipping months.
  const load = loadRange(visibleRange('month', '2026-11-15', 1))
  for (const cursor of ['2026-12-15', '2026-10-15']) {
    assert.ok(covers(load, visibleRange('month', cursor, 1)), `refetch needed for ${cursor}`)
  }
  // Two months out should fall outside, or the padding would be wasted memory.
  assert.ok(!covers(load, visibleRange('month', '2027-02-15', 1)))
})

test('covers rejects a null window', () => {
  assert.equal(covers(null, { from: '2026-11-01', to: '2026-12-01' }), false)
})

test('stepping moves by the view own unit', () => {
  assert.equal(stepCursor('month', '2026-11-15', 1), '2026-12-15')
  assert.equal(stepCursor('month', '2026-11-15', -1), '2026-10-15')
  assert.equal(stepCursor('week', '2026-11-15', 1), '2026-11-22')
  assert.equal(stepCursor('day', '2026-11-15', 1), '2026-11-16')
})

test('stepping a month clamps to the end of a shorter month', () => {
  // 31 January + 1 month must be 28 February, not 3 March.
  assert.equal(stepCursor('month', '2026-01-31', 1), '2026-02-28')
})

test('stepping a month is reversible across a year boundary', () => {
  assert.equal(stepCursor('month', stepCursor('month', '2026-12-15', 1), -1), '2026-12-15')
  assert.equal(stepCursor('month', '2026-12-15', 1), '2027-01-15')
})

test('titles are capitalised and name the right period', () => {
  const month = titleFor('month', '2026-11-22', 1)
  assert.match(month, /2026/)
  assert.equal(month[0], month[0].toUpperCase())

  const day = titleFor('day', '2026-11-22', 1)
  assert.match(day, /2026/)
  assert.equal(day[0], day[0].toUpperCase())

  // A week spanning two months must show both.
  const across = titleFor('week', '2026-12-02', 1)
  assert.match(across, /–/)
})

test('inCursorMonth distinguishes the padding days of the grid', () => {
  assert.equal(inCursorMonth('2026-11-15', '2026-11-22'), true)
  assert.equal(inCursorMonth('2026-10-29', '2026-11-22'), false)
  assert.equal(inCursorMonth('2026-11-15T09:00', '2026-11-22'), true)
})

test('ISO week numbers match the known awkward cases', () => {
  // 2026-01-01 is a Thursday, so it belongs to week 1.
  assert.equal(weekNumber('2026-01-01'), 1)
  // 2027-01-01 is a Friday, which belongs to the last week of 2026.
  assert.equal(weekNumber('2027-01-01'), 53)
  assert.equal(weekNumber('2026-11-22'), 47)
})
