import { test } from 'node:test'
import assert from 'node:assert/strict'

import { matches, normalise, search, searchOccurrences, searchTasks } from '../src/lib/search.ts'
import * as dt from '../src/lib/datetime.ts'
import type { Occurrence, Task } from '../src/lib/types.ts'

let n = 0
const occ = (over: Partial<Occurrence> = {}): Occurrence => ({
  key: `k${++n}`,
  eventId: `e${n}`,
  calendarId: 'cal-1',
  title: 'Планёрка',
  start: '2026-11-22T09:00',
  end: '2026-11-22T10:00',
  allDay: false,
  color: 'violet',
  recurring: false,
  readOnly: false,
  reminders: [],
  ...over,
})

const task = (over: Partial<Task> = {}): Task => ({
  id: `t${++n}`,
  uid: `t${n}@prizma`,
  updatedAt: 1,
  calendarId: 'cal-1',
  title: 'Оплатить интернет',
  done: false,
  priority: 0,
  reminders: [],
  order: 1,
  ...over,
})

test('normalise lowercases and folds ё to е', () => {
  assert.equal(normalise('ПланЁрка'), 'планерка')
  assert.equal(normalise('  Ёлка  '), 'елка')
})

test('a search is case-insensitive and ignores ё', () => {
  assert.ok(matches(['Планёрка'], 'планерка'))
  assert.ok(matches(['Планерка'], 'ПЛАНЁРКА'))
})

test('every term must match, in any order', () => {
  assert.ok(matches(['Ревью дизайна', 'Переговорная 3'], 'дизайн ревью'))
  assert.ok(matches(['Ревью дизайна', 'Переговорная 3'], 'ревью переговорная'))
  assert.equal(matches(['Ревью дизайна'], 'ревью отчёт'), false)
})

test('an empty query matches nothing rather than everything', () => {
  assert.equal(matches(['что угодно'], ''), false)
  assert.equal(matches(['что угодно'], '   '), false)
  assert.deepEqual(searchOccurrences([occ()], ''), [])
  assert.deepEqual(searchTasks([task()], ''), [])
})

test('events match on title, description and location', () => {
  const list = [
    occ({ title: 'Планёрка' }),
    occ({ title: 'Другое', description: 'обсудить бюджет' }),
    occ({ title: 'Третье', location: 'Переговорная 3' }),
    occ({ title: 'Ничего' }),
  ]
  assert.equal(searchOccurrences(list, 'планерка').length, 1)
  assert.equal(searchOccurrences(list, 'бюджет').length, 1)
  assert.equal(searchOccurrences(list, 'переговорная').length, 1)
  assert.equal(searchOccurrences(list, 'отсутствует').length, 0)
})

test('tasks match on title and notes, and deleted ones are skipped', () => {
  const list = [
    task({ title: 'Оплатить интернет' }),
    task({ title: 'Другое', notes: 'позвонить в банк' }),
    task({ title: 'Удалённая', deletedAt: Date.now() }),
  ]
  assert.equal(searchTasks(list, 'интернет').length, 1)
  assert.equal(searchTasks(list, 'банк').length, 1)
  assert.equal(searchTasks(list, 'удалённая').length, 0)
})

test('results mix events and tasks', () => {
  const hits = search([occ({ title: 'Ремонт машины' })], [task({ title: 'Ремонт ноутбука' })], 'ремонт')
  assert.equal(hits.length, 2)
  assert.deepEqual(new Set(hits.map((h) => h.kind)), new Set(['event', 'task']))
})

test('results nearest to today come first', () => {
  const today = dt.today()
  const soon = dt.dateOf(dt.addDays(today, 1))
  const far = dt.dateOf(dt.addDays(today, 40))
  const hits = search(
    [
      occ({ title: 'Встреча далеко', start: `${far}T09:00`, end: `${far}T10:00` }),
      occ({ title: 'Встреча скоро', start: `${soon}T09:00`, end: `${soon}T10:00` }),
    ],
    [],
    'встреча',
  )
  assert.deepEqual(hits.map((h) => h.title), ['Встреча скоро', 'Встреча далеко'])
})

test('a past event is as close as a future one the same distance away', () => {
  const today = dt.today()
  const back = dt.dateOf(dt.addDays(today, -2))
  const forward = dt.dateOf(dt.addDays(today, 30))
  const hits = search(
    [
      occ({ title: 'Б далеко вперёд', start: `${forward}T09:00`, end: `${forward}T10:00` }),
      occ({ title: 'А недавно', start: `${back}T09:00`, end: `${back}T10:00` }),
    ],
    [],
    'а б недавно вперёд'.split(' ')[0],
  )
  // Searching "а" matches both; the recent one must win on distance.
  assert.equal(hits[0].title, 'А недавно')
})

test('results are capped', () => {
  const many = Array.from({ length: 200 }, (_, i) =>
    occ({ title: `Встреча ${i}`, key: `k-${i}`, eventId: `e-${i}` }),
  )
  assert.equal(search(many, [], 'встреча').length, 50)
  assert.equal(search(many, [], 'встреча', 10).length, 10)
})

test('each hit carries what the UI needs to show and to navigate', () => {
  const [hit] = search([occ({ title: 'Планёрка', location: 'Зал' })], [], 'планерка')
  assert.equal(hit.kind, 'event')
  assert.equal(hit.title, 'Планёрка')
  assert.equal(hit.date, '2026-11-22')
  assert.ok(hit.when.length > 0)
  assert.ok(hit.occurrence)
})

test('occurrences of one series are told apart by their date', () => {
  // Regression: three Mondays of the same meeting rendered as three identical
  // "10:00 – 10:30" lines, with nothing to choose between them.
  const hits = search(
    [
      occ({ title: 'Планёрка', start: '2026-11-16T10:00', end: '2026-11-16T10:30', key: 'a' }),
      occ({ title: 'Планёрка', start: '2026-11-23T10:00', end: '2026-11-23T10:30', key: 'b' }),
      occ({ title: 'Планёрка', start: '2026-11-30T10:00', end: '2026-11-30T10:30', key: 'c' }),
    ],
    [],
    'планерка',
  )
  assert.equal(hits.length, 3)
  assert.equal(new Set(hits.map((h) => h.when)).size, 3, `lines were: ${hits.map((h) => h.when).join(' | ')}`)
  assert.ok(hits.every((h) => h.when.includes('10:00')))
})

test('an all-day hit reads as a date, not a time', () => {
  const [hit] = search([occ({ title: 'Отпуск', start: '2026-11-22', end: '2026-11-25', allDay: true })], [], 'отпуск')
  assert.ok(!hit.when.includes(':'), `got ${hit.when}`)
})

test('a task with no deadline still lands somewhere sensible', () => {
  const [hit] = search([], [task({ title: 'Когда-нибудь', due: undefined })], 'когда')
  assert.equal(hit.when, 'Без срока')
  assert.equal(hit.date, dt.today())
})
