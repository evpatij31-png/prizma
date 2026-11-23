import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ReminderScheduler,
  collectReminders,
  createMemorySink,
  delayUntil,
  partitionDue,
  type ScheduledReminder,
} from '../src/lib/reminders.ts'
import type { Occurrence, Task } from '../src/lib/types.ts'

const NOW = '2026-11-22T14:00'
const WINDOW = { from: '2026-11-22T00:00', to: '2026-11-23T00:00' }

let n = 0
const occ = (over: Partial<Occurrence> = {}): Occurrence => ({
  key: `k${++n}`,
  eventId: `e${n}`,
  calendarId: 'cal-1',
  title: 'Встреча',
  start: '2026-11-22T16:00',
  end: '2026-11-22T17:00',
  allDay: false,
  color: 'violet',
  recurring: false,
  readOnly: false,
  reminders: [{ minutesBefore: 15 }],
  ...over,
})

const task = (over: Partial<Task> = {}): Task => ({
  id: `t${++n}`,
  uid: `t${n}@prizma`,
  updatedAt: 1,
  calendarId: 'cal-1',
  title: 'Задача',
  done: false,
  priority: 0,
  order: 1,
  reminders: [{ minutesBefore: 0 }],
  due: '2026-11-22T18:00',
  ...over,
})

/* ------------------------------- collecting ------------------------------- */

test('a reminder fires the stated number of minutes before the event', () => {
  const [r] = collectReminders([occ({ start: '2026-11-22T16:00', reminders: [{ minutesBefore: 15 }] })], [], WINDOW)
  assert.equal(r.at, '2026-11-22T15:45')
  assert.equal(r.kind, 'event')
})

test('minutesBefore of 0 fires at the start', () => {
  const [r] = collectReminders([occ({ start: '2026-11-22T16:00', reminders: [{ minutesBefore: 0 }] })], [], WINDOW)
  assert.equal(r.at, '2026-11-22T16:00')
})

test('two reminders on one event produce two alerts', () => {
  const out = collectReminders(
    [occ({ start: '2026-11-22T16:00', reminders: [{ minutesBefore: 0 }, { minutesBefore: 60 }] })],
    [],
    WINDOW,
  )
  assert.equal(out.length, 2)
  assert.deepEqual(out.map((r) => r.at), ['2026-11-22T15:00', '2026-11-22T16:00'])
  assert.equal(new Set(out.map((r) => r.key)).size, 2, 'keys must differ or one would suppress the other')
})

test('an event with no reminders produces none', () => {
  assert.deepEqual(collectReminders([occ({ reminders: [] })], [], WINDOW), [])
})

test('each occurrence of a series gets its own reminder', () => {
  const series = [
    occ({ eventId: 'e-series', start: '2026-11-22T09:00', reminders: [{ minutesBefore: 10 }] }),
    occ({ eventId: 'e-series', start: '2026-11-22T17:00', reminders: [{ minutesBefore: 10 }] }),
  ]
  const out = collectReminders(series, [], WINDOW)
  assert.equal(out.length, 2)
  assert.equal(new Set(out.map((r) => r.key)).size, 2)
})

test('reminders outside the window are left out', () => {
  const out = collectReminders([occ({ start: '2026-11-25T16:00' })], [], WINDOW)
  assert.deepEqual(out, [])
})

test('the list comes back in time order', () => {
  const out = collectReminders(
    [
      occ({ start: '2026-11-22T20:00', reminders: [{ minutesBefore: 0 }] }),
      occ({ start: '2026-11-22T09:00', reminders: [{ minutesBefore: 0 }] }),
      occ({ start: '2026-11-22T13:00', reminders: [{ minutesBefore: 0 }] }),
    ],
    [],
    WINDOW,
  )
  assert.deepEqual(out.map((r) => r.at), ['2026-11-22T09:00', '2026-11-22T13:00', '2026-11-22T20:00'])
})

test('a task with a deadline and a reminder produces one', () => {
  const [r] = collectReminders([], [task({ due: '2026-11-22T18:00', reminders: [{ minutesBefore: 30 }] })], WINDOW)
  assert.equal(r.at, '2026-11-22T17:30')
  assert.equal(r.kind, 'task')
})

test('a done task produces no reminder', () => {
  assert.deepEqual(collectReminders([], [task({ done: true })], WINDOW), [])
})

test('a deleted task produces no reminder', () => {
  assert.deepEqual(collectReminders([], [task({ deletedAt: Date.now() })], WINDOW), [])
})

test('a task with no deadline produces no reminder', () => {
  assert.deepEqual(collectReminders([], [task({ due: undefined })], WINDOW), [])
})

test('a date-only deadline counts from the start of its day', () => {
  const [r] = collectReminders([], [task({ due: '2026-11-22', reminders: [{ minutesBefore: 0 }] })], WINDOW)
  assert.equal(r.at, '2026-11-22T00:00')
})

test('an all-day event reads as "весь день" rather than a time', () => {
  const [r] = collectReminders(
    [occ({ start: '2026-11-22', end: '2026-11-23', allDay: true, reminders: [{ minutesBefore: 0 }] })],
    [],
    WINDOW,
  )
  assert.match(r.body, /[Вв]есь день/)
})

test('a location is carried into the body', () => {
  const [r] = collectReminders([occ({ location: 'Переговорная 3' })], [], WINDOW)
  assert.match(r.body, /Переговорная 3/)
})

/* ------------------------------- partition -------------------------------- */

const at = (time: string, key = time): ScheduledReminder => ({
  key,
  sourceId: 'e1',
  kind: 'event',
  at: time,
  title: 'Встреча',
  body: '',
})

test('a reminder in the future is scheduled, not shown', () => {
  const { due, next } = partitionDue([at('2026-11-22T16:00')], NOW)
  assert.deepEqual(due, [])
  assert.equal(next?.at, '2026-11-22T16:00')
})

test('the soonest future reminder is the one picked', () => {
  const { next } = partitionDue([at('2026-11-22T20:00'), at('2026-11-22T15:00'), at('2026-11-22T18:00')], NOW)
  assert.equal(next?.at, '2026-11-22T15:00')
})

test('a reminder missed by two minutes is still shown', () => {
  const { due, stale } = partitionDue([at('2026-11-22T13:58')], NOW)
  assert.equal(due.length, 1)
  assert.deepEqual(stale, [])
})

test('a reminder missed by two hours is dropped, not shown', () => {
  // Waking a laptop must not replay the whole morning.
  const { due, stale } = partitionDue([at('2026-11-22T12:00')], NOW)
  assert.deepEqual(due, [])
  assert.equal(stale.length, 1)
})

test('an already-fired reminder is ignored on a later pass', () => {
  const fired = new Set(['k'])
  const { due, next } = partitionDue([at('2026-11-22T13:58', 'k'), at('2026-11-22T16:00', 'other')], NOW, fired)
  assert.deepEqual(due, [])
  assert.equal(next?.key, 'other')
})

test('delayUntil never goes negative', () => {
  assert.equal(delayUntil('2026-11-22T14:30', NOW), 30 * 60_000)
  assert.equal(delayUntil('2026-11-22T13:00', NOW), 0)
})

/* ------------------------------- scheduler -------------------------------- */

/** A scheduler on a clock we control, with one fake timer slot. */
function harness(start = NOW) {
  const sink = createMemorySink()
  let now = start
  let pending: { fn: () => void; ms: number } | null = null
  let timers = 0

  const scheduler = new ReminderScheduler({
    sink,
    now: () => now,
    setTimer: (fn, ms) => {
      pending = { fn, ms }
      return ++timers
    },
    clearTimer: () => {
      pending = null
    },
  })

  return {
    sink,
    scheduler,
    get pending() {
      return pending
    },
    setNow(value: string) {
      now = value
    },
    /** Run the armed timer, as the browser would. */
    fire() {
      const current = pending
      pending = null
      current?.fn()
    },
  }
}

test('a due reminder is shown as soon as the schedule is set', () => {
  const h = harness()
  h.scheduler.update([at('2026-11-22T13:58')])
  assert.equal(h.sink.shown.length, 1)
})

test('exactly one timer is held, whatever the number of reminders', () => {
  const h = harness()
  h.scheduler.update(Array.from({ length: 50 }, (_, i) => at(`2026-11-22T${String(15 + (i % 8)).padStart(2, '0')}:00`, `k${i}`)))
  assert.ok(h.pending, 'a timer must be armed')
  // The harness can only hold one; a second setTimer would overwrite it, and
  // the count proves only one was ever requested.
  assert.equal(h.pending?.ms, 60 * 60_000, 'armed for the nearest reminder, 15:00')
})

test('the timer fires the reminder when the clock reaches it', () => {
  const h = harness()
  h.scheduler.update([at('2026-11-22T14:30')])
  assert.equal(h.sink.shown.length, 0)

  h.setNow('2026-11-22T14:30')
  h.fire()
  assert.equal(h.sink.shown.length, 1)
  assert.equal(h.sink.shown[0].at, '2026-11-22T14:30')
})

test('recomputing twice does not show the same reminder twice', () => {
  // This is what a tab regaining focus does.
  const h = harness()
  const list = [at('2026-11-22T13:58')]
  h.scheduler.update(list)
  h.scheduler.update(list)
  h.scheduler.update(list)
  assert.equal(h.sink.shown.length, 1)
})

test('a stale reminder is never shown but is not reconsidered either', () => {
  const h = harness()
  h.scheduler.update([at('2026-11-22T09:00')])
  assert.equal(h.sink.shown.length, 0)
  assert.equal(h.scheduler.firedCount, 1, 'marked as handled so later passes skip it')
})

test('after one fires, the next is armed', () => {
  const h = harness()
  h.scheduler.update([at('2026-11-22T14:30', 'a'), at('2026-11-22T15:00', 'b')])
  h.setNow('2026-11-22T14:30')
  h.fire()
  assert.deepEqual(h.sink.shown.map((r) => r.key), ['a'])
  assert.equal(h.pending?.ms, 30 * 60_000)
})

test('stop clears the armed timer', () => {
  const h = harness()
  h.scheduler.update([at('2026-11-22T16:00')])
  assert.ok(h.pending)
  h.scheduler.stop()
  assert.equal(h.pending, null)
})

test('an empty schedule arms nothing', () => {
  const h = harness()
  h.scheduler.update([])
  assert.equal(h.pending, null)
  assert.equal(h.sink.shown.length, 0)
})
