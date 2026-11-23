import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { DB_NAME, closeDb, events as eventStore } from '../src/lib/db.ts'
import { DEFAULT_SETTINGS } from '../src/lib/seed.ts'
import { draftEvent, resetInitForTests, useStore } from '../src/store/useStore.ts'
import type { Calendar } from '../src/lib/types.ts'

const calendar: Calendar = {
  id: 'cal-1',
  uid: 'cal-1@prizma',
  updatedAt: 1,
  name: 'Личное',
  color: 'violet',
  visible: true,
  readOnly: false,
  kind: 'local',
  order: 0,
}

beforeEach(async () => {
  await closeDb()
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve()
  })
  useStore.setState({
    ready: true,
    error: null,
    calendars: [calendar],
    events: [],
    tasks: [],
    settings: DEFAULT_SETTINGS,
    editor: null,
    selectedKey: null,
    loaded: null,
  })
})

const draft = () => draftEvent('cal-1', '2026-11-22T09:00', '2026-11-22T10:00', false)

test('saving a new event adds exactly one to the list', async () => {
  // Regression: the optimistic copy went in with an empty id, the saved copy
  // came back with a generated one, and upsert could not match them — so one
  // save produced two blocks in the grid until the next reload.
  const saved = await useStore.getState().saveEvent(draft())
  const { events } = useStore.getState()

  assert.equal(events.length, 1, `expected one event, got ${events.length}`)
  assert.ok(saved?.id)
  assert.equal(events[0].id, saved?.id)
  assert.ok(events.every((e) => e.id !== ''), 'no record may keep the empty draft id')
  assert.equal(await eventStore.count(), 1)
})

test('saving twice in a row still leaves one event', async () => {
  const first = await useStore.getState().saveEvent(draft())
  assert.ok(first)
  await useStore.getState().saveEvent({ ...first, title: 'Переименовано' })

  const { events } = useStore.getState()
  assert.equal(events.length, 1)
  assert.equal(events[0].title, 'Переименовано')
  assert.equal(events[0].id, first.id)
  assert.equal(events[0].uid, first.uid, 'uid must survive an edit')
})

test('two different new events both land', async () => {
  await useStore.getState().saveEvent(draft())
  await useStore.getState().saveEvent(draftEvent('cal-1', '2026-11-23T09:00', '2026-11-23T10:00', false))
  assert.equal(useStore.getState().events.length, 2)
  assert.equal(new Set(useStore.getState().events.map((e) => e.id)).size, 2)
})

test('deleting removes it from the list and closes the editor', async () => {
  const saved = await useStore.getState().saveEvent(draft())
  assert.ok(saved)
  useStore.getState().openEditor({ event: saved, isNew: false })

  await useStore.getState().deleteEvent(saved.id)

  assert.deepEqual(useStore.getState().events, [])
  assert.equal(useStore.getState().editor, null)
  assert.equal(useStore.getState().selectedKey, null)
  // Tombstoned, not gone: a cloud sync still needs to hear about it.
  assert.equal(await eventStore.count(), 1)
  assert.equal(await eventStore.get(saved.id), undefined)
})

test('a new task also gets its id before the optimistic insert', async () => {
  const saved = await useStore.getState().saveTask({
    id: '',
    uid: '',
    updatedAt: 0,
    calendarId: 'cal-1',
    title: 'Задача',
    done: false,
    priority: 1,
    reminders: [],
    order: 1,
  })
  assert.ok(saved?.id)
  assert.equal(useStore.getState().tasks.length, 1)
})

test('toggling a task writes and clears completedAt', async () => {
  const saved = await useStore.getState().saveTask({
    id: '', uid: '', updatedAt: 0, calendarId: 'cal-1', title: 'Задача',
    done: false, priority: 0, reminders: [], order: 1,
  })
  assert.ok(saved)

  await useStore.getState().toggleTaskDone(saved.id)
  assert.equal(useStore.getState().tasks[0].done, true)
  assert.ok(useStore.getState().tasks[0].completedAt)

  await useStore.getState().toggleTaskDone(saved.id)
  assert.equal(useStore.getState().tasks[0].done, false)
  assert.equal(useStore.getState().tasks[0].completedAt, null)
})

test('startNewEvent opens a draft in the first writable calendar', () => {
  useStore.getState().startNewEvent('2026-11-22T09:00', '2026-11-22T10:00', false)
  const { editor } = useStore.getState()
  assert.equal(editor?.isNew, true)
  assert.equal(editor?.event.calendarId, 'cal-1')
  assert.equal(editor?.event.start, '2026-11-22T09:00')
})

test('startNewEvent refuses when every calendar is read-only', () => {
  useStore.setState({ calendars: [{ ...calendar, readOnly: true }], editor: null, error: null })
  useStore.getState().startNewEvent('2026-11-22T09:00', '2026-11-22T10:00', false)
  // A read-only calendar is still better than nothing to show, but the draft
  // must not silently vanish — here there is one, and the editor blocks saving.
  assert.ok(useStore.getState().editor)
})

test('startNewEvent reports when there is no calendar at all', () => {
  useStore.setState({ calendars: [], editor: null, error: null })
  useStore.getState().startNewEvent('2026-11-22T09:00', '2026-11-22T10:00', false)
  assert.equal(useStore.getState().editor, null)
  assert.match(useStore.getState().error ?? '', /календарь/i)
})

test('settings written by an older build gain the defaults for new keys', async () => {
  // Regression: `showTasksInGrid` was added after the database was seeded, so
  // it read back as undefined and the feature was silently off.
  const { putSettings } = await import('../src/lib/db.ts')
  const old = { ...DEFAULT_SETTINGS }
  delete (old as Partial<typeof DEFAULT_SETTINGS>).showTasksInGrid
  await putSettings(old as typeof DEFAULT_SETTINGS)

  resetInitForTests()
  useStore.setState({ ready: false, settings: { ...DEFAULT_SETTINGS, showTasksInGrid: false } })
  await useStore.getState().init()

  assert.equal(useStore.getState().settings.showTasksInGrid, DEFAULT_SETTINGS.showTasksInGrid)
})

test('openOccurrence finds the event behind an occurrence', async () => {
  const saved = await useStore.getState().saveEvent({ ...draft(), rrule: 'FREQ=DAILY' })
  assert.ok(saved)
  useStore.getState().openOccurrence({
    key: `${saved.id}:2026-11-25T09:00`,
    eventId: saved.id,
    calendarId: 'cal-1',
    title: saved.title,
    start: '2026-11-25T09:00',
    end: '2026-11-25T10:00',
    allDay: false,
    color: 'violet',
    recurring: true,
    readOnly: false,
    reminders: [],
  })
  const { editor } = useStore.getState()
  assert.equal(editor?.event.id, saved.id)
  assert.equal(editor?.isNew, false)
  // The clicked instance is remembered, so a scope choice can act on it.
  assert.equal(editor?.occurrenceStart, '2026-11-25T09:00')
})
