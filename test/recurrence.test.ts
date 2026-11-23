import { test } from 'node:test'
import assert from 'node:assert/strict'

import { expand, parseRule, serializeRule, parseIcsStamp, describeRule } from '../src/lib/recurrence.ts'
import * as dt from '../src/lib/datetime.ts'

const range = (rangeStart: string, rangeEnd: string) => ({ rangeStart, rangeEnd })

test('a non-recurring event yields only itself', () => {
  assert.deepEqual(expand('2026-11-22T09:00', undefined, range('2026-11-01', '2026-12-01')), ['2026-11-22T09:00'])
  assert.deepEqual(expand('2026-11-22T09:00', undefined, range('2026-12-01', '2027-01-01')), [])
})

test('DAILY with INTERVAL walks in step', () => {
  const out = expand('2026-11-22T09:00', 'FREQ=DAILY;INTERVAL=3', range('2026-11-22', '2026-12-05'))
  assert.deepEqual(out, [
    '2026-11-22T09:00',
    '2026-11-25T09:00',
    '2026-11-28T09:00',
    '2026-12-01T09:00',
    '2026-12-04T09:00',
  ])
})

test('COUNT is counted from dtstart, not from the visible window', () => {
  // 5 daily occurrences from the 22nd end on the 26th; a window starting on
  // the 25th must therefore show exactly two, not five.
  const out = expand('2026-11-22T09:00', 'FREQ=DAILY;COUNT=5', range('2026-11-25', '2026-12-31'))
  assert.deepEqual(out, ['2026-11-25T09:00', '2026-11-26T09:00'])
})

test('UNTIL is inclusive of the whole final day when it is date-only', () => {
  const out = expand('2026-11-22T09:00', 'FREQ=DAILY;UNTIL=20261125', range('2026-11-01', '2026-12-01'))
  assert.deepEqual(out, ['2026-11-22T09:00', '2026-11-23T09:00', '2026-11-24T09:00', '2026-11-25T09:00'])
})

test('WEEKLY BYDAY expands several weekdays in week order', () => {
  // 2026-11-22 is a Sunday; the series starts mid-week, so the first Monday
  // of that week (the 16th) must NOT appear.
  const out = expand('2026-11-22T18:00', 'FREQ=WEEKLY;BYDAY=MO,WE', range('2026-11-01', '2026-12-10'))
  assert.deepEqual(out, [
    '2026-11-23T18:00', // Mon
    '2026-11-25T18:00', // Wed
    '2026-11-30T18:00',
    '2026-12-02T18:00',
    '2026-12-07T18:00',
    '2026-12-09T18:00',
  ])
})

test('WEEKLY INTERVAL=2 keeps the same parity after skipping ahead', () => {
  const all = expand('2026-01-05T10:00', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', range('2026-01-01', '2026-04-01'))
  const far = expand('2026-01-05T10:00', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', range('2026-03-01', '2026-04-01'))
  // The fast-forward path must land on the same dates the slow walk produces.
  assert.deepEqual(far, all.filter((d) => d >= '2026-03-01'))
  assert.ok(far.length > 0)
})

test('MONTHLY skips months that are too short rather than clamping', () => {
  const out = expand('2026-01-31T09:00', 'FREQ=MONTHLY', range('2026-01-01', '2026-06-01'))
  assert.deepEqual(out, ['2026-01-31T09:00', '2026-03-31T09:00', '2026-05-31T09:00'])
})

test('MONTHLY BYMONTHDAY=-1 lands on the last day of each month', () => {
  const out = expand('2026-01-31T09:00', 'FREQ=MONTHLY;BYMONTHDAY=-1', range('2026-01-01', '2026-05-01'))
  assert.deepEqual(out, ['2026-01-31T09:00', '2026-02-28T09:00', '2026-03-31T09:00', '2026-04-30T09:00'])
})

test('MONTHLY BYDAY with an ordinal picks the nth weekday', () => {
  // Third Thursday of the month — a US-Thanksgiving-shaped rule.
  const out = expand('2026-01-15T09:00', 'FREQ=MONTHLY;BYDAY=3TH', range('2026-01-01', '2026-04-01'))
  assert.deepEqual(out, ['2026-01-15T09:00', '2026-02-19T09:00', '2026-03-19T09:00'])
  for (const d of out) assert.equal(dt.weekday(d), 4) // Thursday
})

test('MONTHLY BYDAY=-1FR lands on the last Friday', () => {
  const out = expand('2026-01-30T09:00', 'FREQ=MONTHLY;BYDAY=-1FR', range('2026-01-01', '2026-04-01'))
  assert.deepEqual(out, ['2026-01-30T09:00', '2026-02-27T09:00', '2026-03-27T09:00'])
})

test('BYSETPOS=-1 over BYDAY picks the last matching day of the month', () => {
  const out = expand('2026-01-30T09:00', 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', range('2026-01-01', '2026-04-01'))
  // Last weekday of Jan/Feb/Mar 2026.
  assert.deepEqual(out, ['2026-01-30T09:00', '2026-02-27T09:00', '2026-03-31T09:00'])
})

test('YEARLY repeats on the same day each year', () => {
  const out = expand('2026-03-08', 'FREQ=YEARLY', range('2026-01-01', '2029-01-01'))
  assert.deepEqual(out, ['2026-03-08', '2027-03-08', '2028-03-08'])
})

test('EXDATE removes a single occurrence from a series', () => {
  const out = expand('2026-11-22T09:00', 'FREQ=DAILY', {
    ...range('2026-11-22', '2026-11-26'),
    exdates: ['2026-11-24T09:00'],
  })
  assert.deepEqual(out, ['2026-11-22T09:00', '2026-11-23T09:00', '2026-11-25T09:00'])
})

test('an occurrence that starts before the window but overlaps it is kept', () => {
  // A 3-day all-day trip starting Friday is still visible on Sunday.
  const out = expand('2026-11-20', 'FREQ=WEEKLY;BYDAY=FR', {
    rangeStart: '2026-11-22',
    rangeEnd: '2026-11-23',
    durationMinutes: 3 * 1440,
  })
  assert.deepEqual(out, ['2026-11-20'])
})

test('a malformed or empty rule is treated as non-recurring, never thrown', () => {
  assert.equal(parseRule(''), null)
  assert.equal(parseRule('FREQ=HOURLY'), null)
  assert.equal(parseRule('nonsense'), null)
  assert.deepEqual(expand('2026-11-22T09:00', 'nonsense', range('2026-11-01', '2026-12-01')), ['2026-11-22T09:00'])
})

test('a full RRULE: line parses the same as a bare body', () => {
  assert.deepEqual(parseRule('RRULE:FREQ=WEEKLY;BYDAY=MO'), parseRule('FREQ=WEEKLY;BYDAY=MO'))
})

test('parse -> serialize round-trips the parts we support', () => {
  for (const r of [
    'FREQ=DAILY',
    'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR',
    'FREQ=MONTHLY;BYMONTHDAY=-1',
    'FREQ=MONTHLY;BYDAY=3TH',
    'FREQ=YEARLY;BYMONTH=3;COUNT=10',
  ]) {
    const rule = parseRule(r)
    assert.ok(rule, `failed to parse ${r}`)
    assert.deepEqual(parseRule(serializeRule(rule)), rule, `round-trip changed ${r}`)
  }
})

test('ICS stamps parse in UTC, date and floating-local forms', () => {
  assert.equal(parseIcsStamp('20261122'), '2026-11-22')
  assert.equal(parseIcsStamp('20261122T093000'), '2026-11-22T09:30')
  // A UTC stamp becomes the local wall clock, so it must match what the
  // platform says the same instant is.
  const asLocal = dt.fromDate(new Date(Date.UTC(2026, 10, 22, 9, 30)))
  assert.equal(parseIcsStamp('20261122T093000Z'), asLocal)
  assert.equal(parseIcsStamp('garbage'), null)
})

test('expansion is bounded even for an open-ended rule', () => {
  const out = expand('2000-01-01T09:00', 'FREQ=DAILY', { limit: 10, rangeStart: '2026-11-22' })
  assert.equal(out.length, 10)
  // The fast-forward backs off one day, so the 21st is *considered* — but a
  // zero-length occurrence on the 21st ends before the window opens, so the
  // range filter drops it and the first result is the 22nd.
  assert.equal(out[0], '2026-11-22T09:00')
  assert.equal(out.at(-1), '2026-12-01T09:00')
})

test('describeRule produces something human for every preset', () => {
  assert.equal(describeRule(undefined), 'Не повторяется')
  assert.match(describeRule('FREQ=WEEKLY;BYDAY=MO,WE'), /Каждую неделю/)
  assert.match(describeRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO'), /Каждые 2 недели/)
  assert.match(describeRule('FREQ=DAILY;COUNT=5'), /5 раз/)
})
