import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  DB_NAME,
  calendars,
  closeDb,
  db,
  events,
  exportDump,
  getSettings,
  importDump,
  purgeAll,
  tasks,
  type Dump,
} from '../src/lib/db.ts'
import { DEFAULT_SETTINGS, seedIfEmpty } from '../src/lib/seed.ts'
import type { CalEvent, Calendar } from '../src/lib/types.ts'

const blank = { id: '', uid: '', updatedAt: 0 }

const aCalendar = (over: Partial<Calendar> = {}): Calendar => ({
  ...blank,
  name: 'Личное',
  color: 'violet',
  visible: true,
  readOnly: false,
  kind: 'local',
  order: 0,
  ...over,
})

const anEvent = (over: Partial<CalEvent> = {}): CalEvent => ({
  ...blank,
  calendarId: 'cal-1',
  title: 'Событие',
  start: '2026-11-22T09:00',
  end: '2026-11-22T10:00',
  allDay: false,
  reminders: [],
  ...over,
})

/** A fresh database for every test, so order between tests cannot matter. */
async function reset() {
  await closeDb()
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve()
  })
}

beforeEach(reset)

test('one connection is reused across calls', async () => {
  assert.equal(await db(), await db())
})

test('put then get round-trips the record', async () => {
  const saved = await calendars.put(aCalendar({ name: 'Работа' }))
  const loaded = await calendars.get(saved.id)
  assert.deepEqual(loaded, saved)
  assert.equal(loaded?.name, 'Работа')
})

test('put fills in id, uid and updatedAt', async () => {
  const before = Date.now()
  const saved = await calendars.put(aCalendar())
  assert.ok(saved.id.length > 0)
  assert.match(saved.uid, /@prizma$/)
  assert.ok(saved.updatedAt >= before)
})

test('put does not rewrite an existing uid', async () => {
  const first = await calendars.put(aCalendar())
  const second = await calendars.put({ ...first, name: 'Переименован' })
  assert.equal(second.uid, first.uid)
  assert.equal(second.id, first.id)
  assert.ok(second.updatedAt >= first.updatedAt)
})

test('remove is a tombstone, not a deletion', async () => {
  const saved = await events.put(anEvent())
  await events.remove(saved.id)

  assert.equal(await events.get(saved.id), undefined)
  assert.deepEqual(await events.list(), [])

  const withDeleted = await events.list({ includeDeleted: true })
  assert.equal(withDeleted.length, 1)
  assert.ok(withDeleted[0].deletedAt != null)

  const raw = await events.get(saved.id, { includeDeleted: true })
  assert.equal(raw?.id, saved.id)
})

test('removing a record that is not there is a no-op', async () => {
  await events.remove('does-not-exist')
  assert.equal(await events.count(), 0)
})

test('inRange returns single events that overlap the window', async () => {
  await events.putMany([
    anEvent({ title: 'внутри', start: '2026-11-22T09:00', end: '2026-11-22T10:00' }),
    anEvent({ title: 'до', start: '2026-11-01T09:00', end: '2026-11-01T10:00' }),
    anEvent({ title: 'после', start: '2026-12-10T09:00', end: '2026-12-10T10:00' }),
    // Starts before the window but runs into it — must be kept.
    anEvent({ title: 'внахлёст', start: '2026-11-19T09:00', end: '2026-11-23T10:00' }),
  ])

  const found = await events.inRange('2026-11-20', '2026-11-25')
  assert.deepEqual(found.map((e) => e.title).sort(), ['внахлёст', 'внутри'])
})

test('inRange keeps a recurring event whose series began long ago', async () => {
  // The whole point: a key range on `start` alone would drop this, because the
  // series starts years before the window. The expander decides, not the index.
  await events.put(anEvent({ title: 'планёрка', start: '2020-01-06T10:00', end: '2020-01-06T10:30', rrule: 'FREQ=WEEKLY;BYDAY=MO' }))
  const found = await events.inRange('2026-11-20', '2026-11-25')
  assert.deepEqual(found.map((e) => e.title), ['планёрка'])
})

test('inRange excludes tombstones unless asked', async () => {
  const saved = await events.put(anEvent())
  await events.remove(saved.id)
  assert.deepEqual(await events.inRange('2026-11-01', '2026-12-01'), [])
  assert.equal((await events.inRange('2026-11-01', '2026-12-01', { includeDeleted: true })).length, 1)
})

test('an event starting exactly at the window end is outside it', async () => {
  await events.put(anEvent({ start: '2026-11-25T00:00', end: '2026-11-25T01:00' }))
  assert.deepEqual(await events.inRange('2026-11-20', '2026-11-25'), [])
})

test('byUid finds an event by its iCalendar identity', async () => {
  const saved = await events.put(anEvent())
  const found = await events.byUid(saved.uid)
  assert.equal(found?.id, saved.id)
  assert.equal(await events.byUid('nope@elsewhere'), undefined)
})

test('putMany writes a batch and stamps each record', async () => {
  const saved = await events.putMany([anEvent({ title: 'a' }), anEvent({ title: 'b' })])
  assert.equal(saved.length, 2)
  assert.equal(new Set(saved.map((e) => e.id)).size, 2)
  assert.equal(new Set(saved.map((e) => e.uid)).size, 2)
  assert.equal(await events.count(), 2)
})

test('putMany with an empty batch does nothing', async () => {
  assert.deepEqual(await events.putMany([]), [])
})

test('purge drops stale tombstones and keeps fresh ones', async () => {
  const old = await events.put(anEvent({ title: 'старое' }))
  const recent = await events.put(anEvent({ title: 'свежее' }))
  const live = await events.put(anEvent({ title: 'живое' }))

  // Backdate one tombstone past the 90-day cutoff by writing it directly.
  const database = await db()
  await database.put('events', { ...old, deletedAt: Date.now() - 200 * 86_400_000 })
  await events.remove(recent.id)

  const purged = await purgeAll()
  assert.equal(purged, 1)

  const remaining = await events.list({ includeDeleted: true })
  assert.deepEqual(remaining.map((e) => e.title).sort(), ['живое', 'свежее'])
  assert.equal((await events.get(live.id))?.title, 'живое')
})

test('exportDump then importDump(replace) restores the state exactly', async () => {
  await seedIfEmpty()
  const before = await exportDump()

  await Promise.all([calendars.clear(), events.clear(), tasks.clear()])
  assert.equal(await events.count(), 0)

  const result = await importDump(before, 'replace')
  assert.equal(result.calendars, before.calendars.length)
  assert.equal(result.events, before.events.length)
  assert.equal(result.tasks, before.tasks.length)

  const after = await exportDump()
  assert.deepEqual(after.calendars, before.calendars)
  assert.deepEqual(after.events, before.events)
  assert.deepEqual(after.tasks, before.tasks)
  assert.deepEqual(after.settings, before.settings)
})

test('importDump preserves updatedAt instead of stamping now', async () => {
  // A restore must not make every record look freshly edited, or the first
  // cloud sync would push the whole backup over newer remote data.
  const dump: Dump = {
    version: 1,
    exportedAt: 1_000,
    calendars: [{ ...aCalendar(), id: 'c1', uid: 'c1@prizma', updatedAt: 1_000 }],
    events: [],
    tasks: [],
    settings: null,
  }
  await importDump(dump, 'replace')
  assert.equal((await calendars.get('c1'))?.updatedAt, 1_000)
})

test('importDump(merge) keeps whichever copy has the newer updatedAt', async () => {
  const base: Dump = {
    version: 1,
    exportedAt: 0,
    calendars: [{ ...aCalendar({ name: 'существующий' }), id: 'c1', uid: 'c1@prizma', updatedAt: 1_000 }],
    events: [],
    tasks: [],
    settings: null,
  }
  await importDump(base, 'replace')

  const older = structuredClone(base)
  older.calendars[0] = { ...older.calendars[0], name: 'старее', updatedAt: 500 }
  const olderResult = await importDump(older, 'merge')
  assert.equal(olderResult.skipped, 1)
  assert.equal((await calendars.get('c1'))?.name, 'существующий')

  const newer = structuredClone(base)
  newer.calendars[0] = { ...newer.calendars[0], name: 'новее', updatedAt: 2_000 }
  const newerResult = await importDump(newer, 'merge')
  assert.equal(newerResult.calendars, 1)
  assert.equal((await calendars.get('c1'))?.name, 'новее')
})

test('importDump rejects something that is not a backup', async () => {
  await assert.rejects(() => importDump({} as Dump), /Not a Prizma backup/)
  await assert.rejects(
    () => importDump({ version: 99, exportedAt: 0, calendars: [], events: [], tasks: [], settings: null }),
    /newer than this app understands/,
  )
})

test('importDump counts records it cannot place', async () => {
  const dump: Dump = {
    version: 1,
    exportedAt: 0,
    calendars: [],
    // @ts-expect-error deliberately malformed payload
    events: [{ title: 'без id' }],
    tasks: [],
    settings: null,
  }
  const result = await importDump(dump, 'replace')
  assert.equal(result.skipped, 1)
  assert.equal(result.events, 0)
})

test('seeding fills an empty database once and only once', async () => {
  const first = await seedIfEmpty()
  assert.equal(first.seeded, true)
  assert.equal(first.calendars, 2)
  assert.ok(first.events > 0)

  const countAfterFirst = await calendars.count()
  const second = await seedIfEmpty()
  assert.equal(second.seeded, false)
  assert.equal(await calendars.count(), countAfterFirst)
})

test('two overlapping seeds do not seed twice', async () => {
  // Regression: React StrictMode calls the init effect twice, both calls read
  // an empty store before either wrote, and every sample event appeared
  // duplicated in the month grid.
  const [a, b] = await Promise.all([seedIfEmpty(), seedIfEmpty(), seedIfEmpty()])
  assert.equal(await calendars.count(), 2)
  assert.deepEqual(a, b, 'concurrent callers should share one result')

  const titles = (await events.list()).map((e) => e.title)
  assert.equal(new Set(titles).size, titles.length, `duplicated: ${titles.join(', ')}`)
})

test('seeding does not come back after the user deletes every calendar', async () => {
  await seedIfEmpty()
  for (const c of await calendars.list()) await calendars.remove(c.id)
  assert.deepEqual(await calendars.list(), [])

  const again = await seedIfEmpty()
  assert.equal(again.seeded, false, 'tombstones must count as "not empty"')
  assert.deepEqual(await calendars.list(), [])
})

test('seeding writes default settings', async () => {
  await seedIfEmpty()
  const settings = await getSettings()
  assert.equal(settings?.weekStart, DEFAULT_SETTINGS.weekStart)
  assert.equal(settings?.snapMinutes, 15)
  assert.equal(settings?.theme, 'dark')
})

test('sample data can be skipped', async () => {
  const result = await seedIfEmpty(false)
  assert.equal(result.seeded, true)
  assert.equal(await events.count(), 0)
  assert.equal(await tasks.count(), 0)
})

test('the sample data demonstrates the three hard cases', async () => {
  await seedIfEmpty()
  const all = await events.list()
  assert.ok(all.some((e) => e.rrule), 'needs a recurring series')
  assert.ok(all.some((e) => e.allDay), 'needs an all-day event')
  // Two events that overlap, so the day layout has something to pack.
  const timed = all.filter((e) => !e.allDay)
  const overlapping = timed.some((a) => timed.some((b) => a.id !== b.id && a.start < b.end && b.start < a.end))
  assert.ok(overlapping, 'needs a pair of overlapping events')
})
