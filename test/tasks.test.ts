import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  countOpen,
  describeDue,
  groupOf,
  groupTasks,
  isOverdue,
  orderBetween,
  orderForIndex,
  sortTasks,
  tasksOnDate,
} from '../src/lib/tasks.ts'
import type { Task } from '../src/lib/types.ts'

const NOW = '2026-11-22T14:00'

let n = 0
const task = (over: Partial<Task> = {}): Task => ({
  id: `t${++n}`,
  uid: `t${n}@prizma`,
  updatedAt: 1,
  calendarId: 'cal-1',
  title: `Задача ${n}`,
  done: false,
  priority: 0,
  reminders: [],
  order: n,
  ...over,
})

/* ------------------------------- overdue -------------------------------- */

test('a task with no deadline is never overdue', () => {
  assert.equal(isOverdue(task(), NOW), false)
})

test('a deadline in the past makes a task overdue', () => {
  assert.equal(isOverdue(task({ due: '2026-11-21' }), NOW), true)
  assert.equal(isOverdue(task({ due: '2026-11-22T09:00' }), NOW), true)
})

test('a deadline later today is not overdue yet', () => {
  assert.equal(isOverdue(task({ due: '2026-11-22T18:00' }), NOW), false)
})

test('a date-only deadline is not missed until the day is over', () => {
  // 14:00 on the day it is due: still today's problem, not yesterday's.
  assert.equal(isOverdue(task({ due: '2026-11-22' }), NOW), false)
  assert.equal(isOverdue(task({ due: '2026-11-21' }), NOW), true)
})

test('a done task is never overdue, however late', () => {
  assert.equal(isOverdue(task({ due: '2020-01-01', done: true }), NOW), false)
})

/* -------------------------------- groups -------------------------------- */

test('tasks fall into the expected groups', () => {
  assert.equal(groupOf(task({ due: '2026-11-20' }), NOW), 'overdue')
  assert.equal(groupOf(task({ due: '2026-11-22T18:00' }), NOW), 'today')
  assert.equal(groupOf(task({ due: '2026-11-25' }), NOW), 'upcoming')
  assert.equal(groupOf(task(), NOW), 'someday')
  assert.equal(groupOf(task({ due: '2026-11-20', done: true }), NOW), 'done')
})

test('the panel order is overdue, today, upcoming, undated', () => {
  const list = [
    task({ title: 'без срока' }),
    task({ title: 'будущая', due: '2026-11-25' }),
    task({ title: 'просроченная', due: '2026-11-18' }),
    task({ title: 'сегодня', due: '2026-11-22T18:00' }),
  ]
  assert.deepEqual(
    sortTasks(list, NOW).map((t) => t.title),
    ['просроченная', 'сегодня', 'будущая', 'без срока'],
  )
})

test('done tasks sink to the bottom', () => {
  const list = [
    task({ title: 'сделана', due: '2026-11-18', done: true }),
    task({ title: 'открыта', due: '2026-11-25' }),
  ]
  assert.deepEqual(sortTasks(list, NOW).map((t) => t.title), ['открыта', 'сделана'])
})

test('within the same deadline, higher priority wins', () => {
  const list = [
    task({ title: 'низкий', due: '2026-11-25', priority: 0, order: 1 }),
    task({ title: 'высокий', due: '2026-11-25', priority: 3, order: 2 }),
  ]
  assert.deepEqual(sortTasks(list, NOW).map((t) => t.title), ['высокий', 'низкий'])
})

test('with equal deadline and priority, the manual order decides', () => {
  const list = [
    task({ title: 'вторая', due: '2026-11-25', priority: 1, order: 20 }),
    task({ title: 'первая', due: '2026-11-25', priority: 1, order: 10 }),
  ]
  assert.deepEqual(sortTasks(list, NOW).map((t) => t.title), ['первая', 'вторая'])
})

test('earlier deadlines come first inside a group', () => {
  const list = [
    task({ title: 'позже', due: '2026-12-01' }),
    task({ title: 'раньше', due: '2026-11-25' }),
  ]
  assert.deepEqual(sortTasks(list, NOW).map((t) => t.title), ['раньше', 'позже'])
})

test('sortTasks does not mutate its input', () => {
  const list = [task({ due: '2026-12-01' }), task({ due: '2026-11-25' })]
  const copy = list.slice()
  sortTasks(list, NOW)
  assert.deepEqual(list, copy)
})

test('groupTasks buckets without losing anyone', () => {
  const list = [
    task({ due: '2026-11-18' }),
    task({ due: '2026-11-22T18:00' }),
    task({ due: '2026-11-25' }),
    task(),
    task({ done: true }),
  ]
  const grouped = groupTasks(list, NOW)
  assert.equal([...grouped.values()].flat().length, list.length)
  assert.deepEqual([...grouped.keys()], ['overdue', 'today', 'upcoming', 'someday', 'done'])
})

/* --------------------------------- grid ---------------------------------- */

test('only dated, open, live tasks reach the all-day row', () => {
  const list = [
    task({ title: 'показать', due: '2026-11-22' }),
    task({ title: 'со временем', due: '2026-11-22T18:00' }),
    task({ title: 'другой день', due: '2026-11-23' }),
    task({ title: 'без срока' }),
    task({ title: 'сделана', due: '2026-11-22', done: true }),
    task({ title: 'удалена', due: '2026-11-22', deletedAt: Date.now() }),
  ]
  assert.deepEqual(
    tasksOnDate(list, '2026-11-22').map((t) => t.title),
    ['показать', 'со временем'],
  )
})

/* -------------------------------- ordering ------------------------------- */

test('orderBetween lands between its neighbours', () => {
  assert.equal(orderBetween(1, 2), 1.5)
  assert.equal(orderBetween(1, 1.5), 1.25)
  assert.ok(orderBetween(10, 20) > 10 && orderBetween(10, 20) < 20)
})

test('orderBetween handles the ends of the list', () => {
  assert.equal(orderBetween(5, undefined), 6)
  assert.equal(orderBetween(undefined, 5), 4)
  assert.equal(orderBetween(), 1)
})

test('orderForIndex only needs the two neighbours, not a renumber', () => {
  const list = [task({ order: 1 }), task({ order: 2 }), task({ order: 3 })]
  const moved = orderForIndex(list, 1)
  assert.ok(moved > 1 && moved < 2, `got ${moved}`)
  // Dropping at the very top and the very bottom still works.
  assert.ok(orderForIndex(list, 0) < 1)
  assert.ok(orderForIndex(list, 3) > 3)
  // The other records are untouched by definition: the function returns a
  // number and never touches the list.
  assert.deepEqual(list.map((t) => t.order), [1, 2, 3])
})

/* -------------------------------- display -------------------------------- */

test('describeDue is null without a deadline and shows the time with one', () => {
  assert.equal(describeDue(task()), null)
  assert.ok(describeDue(task({ due: '2026-11-22' })))
  assert.match(describeDue(task({ due: '2026-11-25T18:30' })) ?? '', /18:30/)
})

test('countOpen ignores done and deleted tasks', () => {
  const list = [task(), task({ done: true }), task({ deletedAt: Date.now() }), task()]
  assert.equal(countOpen(list), 2)
})
