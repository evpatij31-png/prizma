import { test } from 'node:test'
import assert from 'node:assert/strict'

import { applyDrag, atMinutes, isDrag, moveByDays, type DragOrigin } from '../src/lib/drag.ts'

const origin = (over: Partial<DragOrigin> = {}): DragOrigin => ({
  kind: 'move',
  anchorMinutes: 9 * 60,
  anchorDate: '2026-11-22',
  start: '2026-11-22T09:00',
  end: '2026-11-22T10:00',
  allDay: false,
  ...over,
})

test('atMinutes rolls past midnight into the next day', () => {
  assert.equal(atMinutes('2026-11-22', 9 * 60), '2026-11-22T09:00')
  assert.equal(atMinutes('2026-11-22', 0), '2026-11-22T00:00')
  assert.equal(atMinutes('2026-11-22', 24 * 60), '2026-11-23T00:00')
  assert.equal(atMinutes('2026-11-22', 25 * 60), '2026-11-23T01:00')
})

/* --------------------------------- create -------------------------------- */

test('dragging down creates an event of the dragged length', () => {
  const r = applyDrag(origin({ kind: 'create', anchorMinutes: 9 * 60 }), { date: '2026-11-22', minutes: 11 * 60 })
  assert.deepEqual(r, { start: '2026-11-22T09:00', end: '2026-11-22T11:00' })
})

test('dragging upwards creates the same event, not a backwards one', () => {
  const r = applyDrag(origin({ kind: 'create', anchorMinutes: 11 * 60 }), { date: '2026-11-22', minutes: 9 * 60 })
  assert.deepEqual(r, { start: '2026-11-22T09:00', end: '2026-11-22T11:00' })
})

test('a click without movement still creates a usable event', () => {
  const r = applyDrag(
    origin({ kind: 'create', anchorMinutes: 9 * 60 }),
    { date: '2026-11-22', minutes: 9 * 60 },
    { minMinutes: 30 },
  )
  assert.deepEqual(r, { start: '2026-11-22T09:00', end: '2026-11-22T09:30' })
})

test('a create drag ignores sideways movement', () => {
  // Painting a time range while the pointer wanders into tomorrow's column
  // should not silently move the event there.
  const r = applyDrag(origin({ kind: 'create', anchorMinutes: 9 * 60 }), { date: '2026-11-25', minutes: 10 * 60 })
  assert.equal(r.start, '2026-11-22T09:00')
  assert.equal(r.end, '2026-11-22T10:00')
})

test('a create drag cannot run past the end of the visible day', () => {
  const r = applyDrag(
    origin({ kind: 'create', anchorMinutes: 21 * 60 }),
    { date: '2026-11-22', minutes: 23 * 60 },
    { dayEndHour: 22 },
  )
  assert.equal(r.end, '2026-11-22T22:00')
})

/* ---------------------------------- move --------------------------------- */

test('moving keeps the length and shifts both ends', () => {
  const r = applyDrag(origin(), { date: '2026-11-22', minutes: 14 * 60 })
  assert.deepEqual(r, { start: '2026-11-22T14:00', end: '2026-11-22T15:00' })
})

test('moving into another column changes the day, keeping the time offset', () => {
  const r = applyDrag(origin(), { date: '2026-11-25', minutes: 9 * 60 })
  assert.deepEqual(r, { start: '2026-11-25T09:00', end: '2026-11-25T10:00' })
})

test('moving respects where inside the block the drag started', () => {
  // Grabbing a 09:00-10:00 event at 09:30 and dropping at 14:30 must land the
  // event at 14:00, not 14:30 — otherwise blocks jump under the cursor.
  const r = applyDrag(origin({ anchorMinutes: 9 * 60 + 30 }), { date: '2026-11-22', minutes: 14 * 60 + 30 })
  assert.deepEqual(r, { start: '2026-11-22T14:00', end: '2026-11-22T15:00' })
})

test('moving backwards in time works the same way', () => {
  const r = applyDrag(origin(), { date: '2026-11-20', minutes: 7 * 60 })
  assert.deepEqual(r, { start: '2026-11-20T07:00', end: '2026-11-20T08:00' })
})

test('moving an event across midnight keeps it whole', () => {
  const r = applyDrag(
    origin({ start: '2026-11-22T23:00', end: '2026-11-23T00:30', anchorMinutes: 23 * 60 }),
    { date: '2026-11-22', minutes: 23 * 60 + 45 },
  )
  assert.equal(r.start, '2026-11-22T23:45')
  assert.equal(r.end, '2026-11-23T01:15')
})

/* --------------------------------- resize -------------------------------- */

test('dragging the bottom edge changes the end and not the start', () => {
  const r = applyDrag(origin({ kind: 'resize-end' }), { date: '2026-11-22', minutes: 12 * 60 })
  assert.deepEqual(r, { start: '2026-11-22T09:00', end: '2026-11-22T12:00' })
})

test('the bottom edge cannot be dragged above the start', () => {
  const r = applyDrag(
    origin({ kind: 'resize-end' }),
    { date: '2026-11-22', minutes: 7 * 60 },
    { minMinutes: 15 },
  )
  assert.deepEqual(r, { start: '2026-11-22T09:00', end: '2026-11-22T09:15' })
})

test('dragging the top edge changes the start and not the end', () => {
  const r = applyDrag(origin({ kind: 'resize-start' }), { date: '2026-11-22', minutes: 7 * 60 })
  assert.deepEqual(r, { start: '2026-11-22T07:00', end: '2026-11-22T10:00' })
})

test('the top edge cannot be dragged below the end', () => {
  const r = applyDrag(
    origin({ kind: 'resize-start' }),
    { date: '2026-11-22', minutes: 23 * 60 },
    { minMinutes: 15 },
  )
  assert.deepEqual(r, { start: '2026-11-22T09:45', end: '2026-11-22T10:00' })
})

test('resizing the end past midnight extends into the next day', () => {
  const r = applyDrag(
    origin({ kind: 'resize-end', start: '2026-11-22T23:00', end: '2026-11-22T23:30' }),
    { date: '2026-11-23', minutes: 60 },
  )
  assert.equal(r.start, '2026-11-22T23:00')
  assert.equal(r.end, '2026-11-23T01:00')
})

/* -------------------------------- helpers -------------------------------- */

test('a small wobble is a click, a real move is a drag', () => {
  assert.equal(isDrag({ x: 10, y: 10 }, { x: 11, y: 12 }), false)
  assert.equal(isDrag({ x: 10, y: 10 }, { x: 10, y: 16 }), true)
  assert.equal(isDrag({ x: 10, y: 10 }, { x: 20, y: 10 }), true)
})

test('moveByDays shifts an all-day event and keeps its length', () => {
  const r = moveByDays('2026-11-21', '2026-11-23', 3)
  assert.deepEqual(r, { start: '2026-11-24', end: '2026-11-26' })
})

test('moveByDays keeps the time of day for a timed event', () => {
  const r = moveByDays('2026-11-21T09:00', '2026-11-21T10:30', -2)
  assert.deepEqual(r, { start: '2026-11-19T09:00', end: '2026-11-19T10:30' })
})

test('moveByDays by zero is a no-op', () => {
  assert.deepEqual(moveByDays('2026-11-21', '2026-11-23', 0), {
    start: '2026-11-21',
    end: '2026-11-23',
  })
})
