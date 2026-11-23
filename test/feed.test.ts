import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_REFRESH_MINUTES,
  FeedError,
  describeOutcome,
  diffFeed,
  fetchFeedDiff,
  isDue,
  normaliseUrl,
  type Fetcher,
} from '../src/lib/feed.ts'
import { serializeIcs } from '../src/lib/ics.ts'
import type { CalEvent } from '../src/lib/types.ts'
import type { ParsedEvent } from '../src/lib/ics.ts'

const CAL = 'feed-cal'

let n = 0
const stored = (over: Partial<CalEvent> = {}): CalEvent => ({
  id: `s${++n}`,
  uid: `u${n}@remote`,
  updatedAt: 1,
  calendarId: CAL,
  title: `Событие ${n}`,
  start: '2026-11-22T09:00',
  end: '2026-11-22T10:00',
  allDay: false,
  reminders: [],
  readOnly: true,
  ...over,
})

const incoming = (over: Partial<ParsedEvent> = {}): ParsedEvent => ({
  uid: 'u1@remote',
  title: 'Событие 1',
  start: '2026-11-22T09:00',
  end: '2026-11-22T10:00',
  allDay: false,
  reminders: [],
  ...over,
})

/* ---------------------------------- urls ---------------------------------- */

test('webcal links are rewritten to https', () => {
  assert.equal(normaliseUrl('webcal://example.com/a.ics'), 'https://example.com/a.ics')
  assert.equal(normaliseUrl('WEBCAL://example.com/a.ics'), 'https://example.com/a.ics')
  assert.equal(normaliseUrl('  https://example.com/a.ics  '), 'https://example.com/a.ics')
})

/* ---------------------------------- diff ---------------------------------- */

test('a first sync adds everything', () => {
  const diff = diffFeed([], [incoming({ uid: 'a@r' }), incoming({ uid: 'b@r' })], CAL)
  assert.equal(diff.added, 2)
  assert.equal(diff.writes.length, 2)
  assert.deepEqual(diff.deletes, [])
  assert.ok(diff.writes.every((e) => e.readOnly === true), 'feed events must be read-only')
  assert.ok(diff.writes.every((e) => e.calendarId === CAL))
})

test('re-reading an unchanged feed changes nothing', () => {
  // Idempotence is the whole point: an hourly refresh must not grow the
  // calendar every hour.
  const existing = [stored({ uid: 'a@r', title: 'Встреча' })]
  const diff = diffFeed(existing, [incoming({ uid: 'a@r', title: 'Встреча' })], CAL)
  assert.deepEqual(diff.writes, [])
  assert.deepEqual(diff.deletes, [])
  assert.equal(diff.unchanged, 1)
})

test('a changed event is updated in place, keeping its id', () => {
  const existing = [stored({ id: 'keep-me', uid: 'a@r', title: 'Старое' })]
  const diff = diffFeed(existing, [incoming({ uid: 'a@r', title: 'Новое' })], CAL)
  assert.equal(diff.updated, 1)
  assert.equal(diff.writes[0].id, 'keep-me')
  assert.equal(diff.writes[0].title, 'Новое')
})

test('every field a feed owns counts as a change', () => {
  const base = stored({ uid: 'a@r' })
  const cases: Partial<ParsedEvent>[] = [
    { title: 'другое' },
    { start: '2026-11-22T11:00' },
    { end: '2026-11-22T12:00' },
    { allDay: true },
    { description: 'появилось' },
    { location: 'появилось' },
    { rrule: 'FREQ=DAILY' },
    { exdates: ['2026-11-23T09:00'] },
  ]
  for (const change of cases) {
    const diff = diffFeed([base], [incoming({ uid: 'a@r', ...change })], CAL)
    assert.equal(diff.updated, 1, `change ignored: ${JSON.stringify(change)}`)
  }
})

test('an event that vanished from the feed is tombstoned', () => {
  const existing = [stored({ id: 'gone', uid: 'a@r' }), stored({ id: 'stays', uid: 'b@r' })]
  const diff = diffFeed(existing, [incoming({ uid: 'b@r', title: 'Событие 2' })], CAL)
  assert.deepEqual(diff.deletes, ['gone'])
  assert.equal(diff.removed, 1)
})

test('an event already tombstoned is not deleted twice', () => {
  const existing = [stored({ id: 'gone', uid: 'a@r', deletedAt: Date.now() })]
  const diff = diffFeed(existing, [], CAL)
  assert.deepEqual(diff.deletes, [])
  assert.equal(diff.removed, 0)
})

test('an event returning to the feed revives its record instead of duplicating', () => {
  const existing = [stored({ id: 'revive', uid: 'a@r', deletedAt: Date.now() })]
  const diff = diffFeed(existing, [incoming({ uid: 'a@r' })], CAL)
  assert.equal(diff.writes.length, 1)
  assert.equal(diff.writes[0].id, 'revive')
  assert.equal(diff.writes[0].deletedAt, null)
  assert.equal(diff.added, 0, 'it is an update, not a new event')
})

test('an import matches a UID that lives in another calendar', () => {
  // Regression: importing an .ics into "Личное" when the event already sat in
  // "Работа" created a second copy with the same UID. Found in the browser,
  // not by a test.
  const existing = [stored({ id: 'already-here', uid: 'a@r', calendarId: 'work', title: 'Старое' })]
  const diff = diffFeed(existing, [incoming({ uid: 'a@r', title: 'Новое' })], 'personal', {
    scope: 'all',
    removeMissing: false,
    readOnly: false,
  })
  assert.equal(diff.added, 0)
  assert.equal(diff.updated, 1)
  assert.equal(diff.writes[0].id, 'already-here')
  assert.equal(diff.writes[0].calendarId, 'work', 'a matched event stays in its own calendar')
})

test('an import still files a genuinely new event in the chosen calendar', () => {
  const diff = diffFeed([], [incoming({ uid: 'new@r' })], 'personal', {
    scope: 'all',
    removeMissing: false,
    readOnly: false,
  })
  assert.equal(diff.added, 1)
  assert.equal(diff.writes[0].calendarId, 'personal')
  assert.equal(diff.writes[0].readOnly, false)
})

test('an import never deletes, whatever is missing from the file', () => {
  const existing = [stored({ uid: 'a@r' }), stored({ uid: 'b@r' })]
  const diff = diffFeed(existing, [], 'personal', { scope: 'all', removeMissing: false })
  assert.deepEqual(diff.deletes, [])
})

test('events of other calendars are left alone', () => {
  const existing = [stored({ id: 'mine', uid: 'a@r', calendarId: 'local-cal' })]
  const diff = diffFeed(existing, [], CAL)
  assert.deepEqual(diff.deletes, [], 'a local calendar must not be emptied by a feed refresh')
})

test('local reminders on a feed event survive a refresh', () => {
  const existing = [stored({ uid: 'a@r', reminders: [{ minutesBefore: 15 }], title: 'Старое' })]
  const diff = diffFeed(existing, [incoming({ uid: 'a@r', title: 'Новое' })], CAL)
  assert.deepEqual(diff.writes[0].reminders, [{ minutesBefore: 15 }])
})

/* -------------------------------- fetching -------------------------------- */

const fakeFetcher = (text: string): Fetcher => ({ fetchText: async () => text })

test('fetchFeedDiff parses and diffs what it is given', async () => {
  const ics = serializeIcs(
    [
      {
        id: 'x', uid: 'remote-1@r', updatedAt: 1, calendarId: 'any',
        title: 'Из ленты', start: '2026-11-22T09:00', end: '2026-11-22T10:00',
        allDay: false, reminders: [],
      },
    ],
    { now: new Date(Date.UTC(2026, 10, 22, 12)) },
  )
  const outcome = await fetchFeedDiff({ id: CAL, url: 'https://example.com/a.ics' }, [], fakeFetcher(ics))
  assert.equal(outcome.added, 1)
  assert.equal(outcome.skipped, 0)
  assert.equal(outcome.writes[0].title, 'Из ленты')
})

test('a calendar with no url is rejected clearly', async () => {
  await assert.rejects(
    () => fetchFeedDiff({ id: CAL, url: undefined }, [], fakeFetcher('')),
    (e: unknown) => e instanceof FeedError && e.kind === 'invalid-url',
  )
})

test('a broken record in the feed is counted, not fatal', async () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:ok@r',
    'DTSTART:20261122T090000',
    'SUMMARY:Нормальное',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:broken@r',
    'SUMMARY:Без даты',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
  const outcome = await fetchFeedDiff({ id: CAL, url: 'https://example.com/a.ics' }, [], fakeFetcher(ics))
  assert.equal(outcome.added, 1)
  assert.equal(outcome.skipped, 1)
})

/* -------------------------------- schedule -------------------------------- */

test('a feed never synced is due now', () => {
  assert.equal(isDue({ lastSyncAt: undefined, refreshMinutes: 60 }), true)
})

test('a feed synced recently is not due', () => {
  const now = Date.now()
  assert.equal(isDue({ lastSyncAt: now - 10 * 60_000, refreshMinutes: 60 }, now), false)
  assert.equal(isDue({ lastSyncAt: now - 61 * 60_000, refreshMinutes: 60 }, now), true)
})

test('a missing interval falls back to the default', () => {
  const now = Date.now()
  assert.equal(isDue({ lastSyncAt: now - (DEFAULT_REFRESH_MINUTES - 1) * 60_000 }, now), false)
  assert.equal(isDue({ lastSyncAt: now - (DEFAULT_REFRESH_MINUTES + 1) * 60_000 }, now), true)
})

/* -------------------------------- reporting ------------------------------- */

test('the outcome reads as a sentence', () => {
  assert.equal(describeOutcome({ added: 0, updated: 0, removed: 0, unchanged: 5, skipped: 0, writes: [], deletes: [] }), 'Изменений нет')
  assert.match(describeOutcome({ added: 2, updated: 1, removed: 0, unchanged: 0, skipped: 3, writes: [], deletes: [] }), /добавлено 2/)
  assert.match(describeOutcome({ added: 0, updated: 0, removed: 4, unchanged: 0, skipped: 0, writes: [], deletes: [] }), /удалено 4/)
})
