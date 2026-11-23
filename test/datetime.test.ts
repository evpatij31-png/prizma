import { test } from 'node:test'
import assert from 'node:assert/strict'

import * as dt from '../src/lib/datetime.ts'

test('parse reads a date-only value as midnight', () => {
  assert.deepEqual(dt.parse('2026-11-22'), { y: 2026, m: 11, d: 22, h: 0, mi: 0 })
})

test('parse reads a date-time value', () => {
  assert.deepEqual(dt.parse('2026-11-22T09:30'), { y: 2026, m: 11, d: 22, h: 9, mi: 30 })
  // Seconds from an ICS stamp are tolerated and dropped.
  assert.deepEqual(dt.parse('2026-11-22T09:30:45'), { y: 2026, m: 11, d: 22, h: 9, mi: 30 })
})

test('parse refuses a value whose time it cannot read', () => {
  // Regression: "T010:00" used to become midnight silently, which would move
  // an imported event to the start of the day with no sign anything was wrong.
  assert.throws(() => dt.parse('2026-11-20T010:00'), /Unreadable time/)
  assert.throws(() => dt.parse('2026-11-20T9:00'), /Unreadable time/)
  assert.throws(() => dt.parse('2026-11-20Tnonsense'), /Unreadable time/)
  assert.throws(() => dt.parse('rubbish'), /Not a local date\/time/)
})

test('adding days keeps the time of day exactly', () => {
  assert.equal(dt.addDays('2026-11-22T09:30', 1), '2026-11-23T09:30')
  assert.equal(dt.addDays('2026-11-22T09:30', -1), '2026-11-21T09:30')
  assert.equal(dt.addDays('2026-11-22', 1), '2026-11-23')
  // Across a month and a year boundary.
  assert.equal(dt.addDays('2026-11-30T23:00', 1), '2026-12-01T23:00')
  assert.equal(dt.addDays('2026-12-31T23:00', 1), '2027-01-01T23:00')
})

test('adding months clamps to a shorter month instead of spilling over', () => {
  assert.equal(dt.addMonths('2026-01-31', 1), '2026-02-28')
  assert.equal(dt.addMonths('2026-01-31', 3), '2026-04-30')
  assert.equal(dt.addMonths('2024-01-31', 1), '2024-02-29') // leap year
  assert.equal(dt.addMonths('2026-11-15T08:00', 2), '2027-01-15T08:00')
})

test('minute arithmetic crosses midnight correctly', () => {
  assert.equal(dt.addMinutes('2026-11-22T23:30', 45), '2026-11-23T00:15')
  assert.equal(dt.addMinutes('2026-11-22T00:15', -30), '2026-11-21T23:45')
})

test('diffDays counts calendar days, not elapsed hours', () => {
  assert.equal(dt.diffDays('2026-11-22', '2026-11-25'), 3)
  assert.equal(dt.diffDays('2026-11-22T23:59', '2026-11-23T00:01'), 1)
  assert.equal(dt.diffDays('2026-11-25', '2026-11-22'), -3)
})

test('week starts follow the setting', () => {
  // 2026-11-22 is a Sunday.
  assert.equal(dt.startOfWeek('2026-11-22', 1), '2026-11-16')
  assert.equal(dt.startOfWeek('2026-11-22', 0), '2026-11-22')
  assert.equal(dt.weekday('2026-11-22'), 0)
})

test('the month grid is always six full weeks', () => {
  for (const month of ['2026-01-15', '2026-02-15', '2026-11-15', '2027-05-15']) {
    const grid = dt.monthGrid(month, 1)
    assert.equal(grid.length, 42, `${month} grid was ${grid.length}`)
    assert.equal(dt.weekday(grid[0]), 1, `${month} grid does not start on Monday`)
    assert.ok(grid[0] <= dt.startOfMonth(month))
    assert.ok(grid[41] >= dt.endOfMonth(month))
  }
})

test('end of month knows about leap years', () => {
  assert.equal(dt.endOfMonth('2026-02-10'), '2026-02-28')
  assert.equal(dt.endOfMonth('2024-02-10'), '2024-02-29')
  assert.equal(dt.daysInMonth(2026, 2), 28)
  assert.equal(dt.daysInMonth(2024, 2), 29)
})

test('half-open overlap excludes touching ranges', () => {
  assert.equal(dt.overlaps('2026-11-22T09:00', '2026-11-22T10:00', '2026-11-22T10:00', '2026-11-22T11:00'), false)
  assert.equal(dt.overlaps('2026-11-22T09:00', '2026-11-22T10:00', '2026-11-22T09:59', '2026-11-22T11:00'), true)
})

test('snapping rounds to the nearest step', () => {
  assert.equal(dt.snap(7, 15), 0)
  assert.equal(dt.snap(8, 15), 15)
  assert.equal(dt.snap(22, 15), 15)
  assert.equal(dt.snap(23, 15), 30)
})

test('withTime clamps instead of rolling into the next day', () => {
  assert.equal(dt.withTime('2026-11-22', 9 * 60 + 30), '2026-11-22T09:30')
  assert.equal(dt.withTime('2026-11-22', -10), '2026-11-22T00:00')
  assert.equal(dt.withTime('2026-11-22', 99_999), '2026-11-22T23:59')
})

test('datesBetween is inclusive and copes with a reversed range', () => {
  assert.deepEqual(dt.datesBetween('2026-11-22', '2026-11-24'), ['2026-11-22', '2026-11-23', '2026-11-24'])
  assert.deepEqual(dt.datesBetween('2026-11-22', '2026-11-22'), ['2026-11-22'])
  assert.deepEqual(dt.datesBetween('2026-11-24', '2026-11-22'), [])
})

test('weekday headers follow the week start and there are seven', () => {
  const monday = dt.weekdayHeaders(1)
  const sunday = dt.weekdayHeaders(0)
  assert.equal(monday.length, 7)
  assert.equal(sunday.length, 7)
  assert.notDeepEqual(monday, sunday)
  // Rotating one must produce the other.
  assert.deepEqual(sunday.slice(1), monday.slice(0, 6))
})

test('an all-day range is formatted by its inclusive last day', () => {
  // End is exclusive in storage, so 22 -> 24 reads as "22 - 23".
  const text = dt.formatRange('2026-11-22', '2026-11-24', true)
  assert.match(text, /–/)
  assert.ok(!text.includes('24'), `should not show the exclusive end: ${text}`)
})

test('duration is rendered in hours and minutes', () => {
  assert.equal(dt.formatDuration(90), '1 ч 30 мин')
  assert.equal(dt.formatDuration(60), '1 ч')
  assert.equal(dt.formatDuration(45), '45 мин')
  assert.equal(dt.formatDuration(0), '0 мин')
})
