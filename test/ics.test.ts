import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  escapeText,
  fold,
  icsFileName,
  parseContentLine,
  parseDuration,
  parseIcs,
  serializeIcs,
  shiftZone,
  unescapeText,
  unfold,
} from '../src/lib/ics.ts'
import * as dt from '../src/lib/datetime.ts'
import type { CalEvent } from '../src/lib/types.ts'

/** Wrap VEVENT bodies in a minimal calendar. */
const cal = (...bodies: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN', ...bodies, 'END:VCALENDAR'].join('\r\n')

const vevent = (...lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n')

/* -------------------------------- plumbing -------------------------------- */

test('folded lines are joined back together', () => {
  const long = 'Совещание по планированию квартала с участием всех руководителей направлений'
  const folded = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20261122T090000\r\nSUMMARY:${long.slice(0, 30)}\r\n ${long.slice(30, 60)}\r\n ${long.slice(60)}\r\nEND:VEVENT\r\nEND:VCALENDAR`
  const { events } = parseIcs(folded)
  assert.equal(events.length, 1)
  assert.equal(events[0].title, long)
})

test('a tab also continues a folded line', () => {
  const text = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20261122T090000\r\nSUMMARY:Часть\r\n\tвторая\r\nEND:VEVENT\r\nEND:VCALENDAR'
  assert.equal(parseIcs(text).events[0].title, 'Частьвторая')
})

test('CRLF, LF and bare CR all parse the same', () => {
  const body = cal(vevent('UID:a@test', 'DTSTART:20261122T090000', 'DTEND:20261122T100000', 'SUMMARY:Встреча'))
  const crlf = parseIcs(body)
  const lf = parseIcs(body.replace(/\r\n/g, '\n'))
  const cr = parseIcs(body.replace(/\r\n/g, '\r'))
  assert.deepEqual(lf.events, crlf.events)
  assert.deepEqual(cr.events, crlf.events)
  assert.equal(crlf.events.length, 1)
})

test('unfold drops empty lines and keeps content', () => {
  assert.deepEqual(unfold('A:1\r\n\r\nB:2'), ['A:1', 'B:2'])
})

test('the value starts at the first colon outside quotes', () => {
  const line = parseContentLine('DTSTART;TZID="Europe/Berlin":20261122T090000')
  assert.equal(line?.name, 'DTSTART')
  assert.equal(line?.params.get('TZID'), 'Europe/Berlin')
  assert.equal(line?.value, '20261122T090000')
})

test('a line with no colon is ignored rather than throwing', () => {
  assert.equal(parseContentLine('GARBAGE'), null)
  assert.equal(parseContentLine(':leading'), null)
})

test('TEXT escaping round-trips', () => {
  assert.equal(unescapeText('Встреча\\, важная\\nвторая строка'), 'Встреча, важная\nвторая строка')
  assert.equal(unescapeText('точка\\; с запятой'), 'точка; с запятой')
  assert.equal(unescapeText('обратный\\\\слеш'), 'обратный\\слеш')
  assert.equal(unescapeText(escapeText('a,b;c\\d\ne')), 'a,b;c\\d\ne')
})

test('escaped characters survive a real parse', () => {
  const { events } = parseIcs(
    cal(vevent('DTSTART:20261122T090000', 'SUMMARY:Встреча\\, важная\\nвторая строка')),
  )
  assert.equal(events[0].title, 'Встреча, важная\nвторая строка')
})

test('durations parse in all the usual shapes', () => {
  assert.equal(parseDuration('PT90M'), 90)
  assert.equal(parseDuration('PT1H30M'), 90)
  assert.equal(parseDuration('P1D'), 1440)
  assert.equal(parseDuration('P1W'), 7 * 1440)
  assert.equal(parseDuration('PT45S'), 1)
  assert.equal(parseDuration('nonsense'), null)
  assert.equal(parseDuration('P'), null)
})

/* ---------------------------------- dates --------------------------------- */

test('a UTC stamp becomes the local wall clock', () => {
  const { events } = parseIcs(cal(vevent('DTSTART:20261122T093000Z', 'DTEND:20261122T103000Z')))
  assert.equal(events[0].start, dt.fromDate(new Date(Date.UTC(2026, 10, 22, 9, 30))))
})

test('a floating time is taken exactly as written', () => {
  const { events } = parseIcs(cal(vevent('DTSTART:20261122T090000', 'DTEND:20261122T100000')))
  assert.equal(events[0].start, '2026-11-22T09:00')
})

test('TZID is read as a wall clock in that zone, not as UTC', () => {
  const { events } = parseIcs(
    cal(vevent('DTSTART;TZID=Europe/Berlin:20261122T090000', 'DTEND;TZID=Europe/Berlin:20261122T100000')),
  )
  // 09:00 in Berlin is a specific instant; it must land on whatever that
  // instant is called here.
  const expected = dt.fromDate(new Date(Date.UTC(2026, 10, 22, 8, 0))) // Berlin is UTC+1 in November
  assert.equal(events[0].start, expected)
})

test('an unknown TZID falls back to floating instead of dropping the event', () => {
  assert.equal(shiftZone('2026-11-22T09:00', 'Mars/Olympus'), '2026-11-22T09:00')
  const { events, skipped } = parseIcs(cal(vevent('DTSTART;TZID=Mars/Olympus:20261122T090000')))
  assert.equal(skipped, 0)
  assert.equal(events[0].start, '2026-11-22T09:00')
})

test('VALUE=DATE gives a one-day all-day event, not two', () => {
  // DTEND is already exclusive in the file; shifting it again would add a day.
  const { events } = parseIcs(
    cal(vevent('DTSTART;VALUE=DATE:20261122', 'DTEND;VALUE=DATE:20261123', 'SUMMARY:Отпуск')),
  )
  assert.equal(events[0].allDay, true)
  assert.equal(events[0].start, '2026-11-22')
  assert.equal(events[0].end, '2026-11-23')
  assert.equal(dt.diffDays(events[0].start, events[0].end), 1)
})

test('an eight-digit DTSTART is all-day even without VALUE=DATE', () => {
  const { events } = parseIcs(cal(vevent('DTSTART:20261122')))
  assert.equal(events[0].allDay, true)
  assert.equal(events[0].end, '2026-11-23')
})

test('DURATION is used when DTEND is missing', () => {
  const { events } = parseIcs(cal(vevent('DTSTART:20261122T090000', 'DURATION:PT90M')))
  assert.equal(events[0].end, '2026-11-22T10:30')
})

test('an event with neither DTEND nor DURATION gets a sensible length', () => {
  const { events } = parseIcs(cal(vevent('DTSTART:20261122T090000')))
  assert.equal(events[0].end, '2026-11-22T10:00')
})

test('a DTEND before DTSTART is repaired rather than kept', () => {
  const { events } = parseIcs(cal(vevent('DTSTART:20261122T090000', 'DTEND:20261122T080000')))
  assert.ok(events[0].end > events[0].start)
})

/* -------------------------------- survival -------------------------------- */

test('one broken event among three costs only that one', () => {
  const text = cal(
    vevent('UID:a@test', 'DTSTART:20261122T090000', 'SUMMARY:Первая'),
    vevent('UID:b@test', 'SUMMARY:Без даты'), // no DTSTART — unreadable
    vevent('UID:c@test', 'DTSTART:20261124T090000', 'SUMMARY:Третья'),
  )
  const { events, skipped } = parseIcs(text)
  assert.deepEqual(events.map((e) => e.title), ['Первая', 'Третья'])
  assert.equal(skipped, 1)
})

test('an unterminated event at the end of the file counts as skipped', () => {
  const text = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a@test\r\nDTSTART:20261122T090000'
  const { events, skipped } = parseIcs(text)
  assert.deepEqual(events, [])
  assert.equal(skipped, 1)
})

test('VALARM does not leak its properties into the event', () => {
  const text = cal(
    [
      'BEGIN:VEVENT',
      'UID:a@test',
      'DTSTART:20261122T090000',
      'SUMMARY:Встреча',
      'BEGIN:VALARM',
      'TRIGGER:-PT15M',
      'ACTION:DISPLAY',
      'SUMMARY:Напоминание',
      'DESCRIPTION:Не должно попасть в событие',
      'END:VALARM',
      'END:VEVENT',
    ].join('\r\n'),
  )
  const { events, skipped } = parseIcs(text)
  assert.equal(skipped, 0)
  assert.equal(events[0].title, 'Встреча', 'the alarm SUMMARY must not win')
  assert.equal(events[0].description, undefined)
})

test('VTODO and VTIMEZONE are skipped without breaking the events after them', () => {
  const text = cal(
    ['BEGIN:VTIMEZONE', 'TZID:Europe/Berlin', 'BEGIN:STANDARD', 'DTSTART:19701025T030000', 'END:STANDARD', 'END:VTIMEZONE'].join('\r\n'),
    ['BEGIN:VTODO', 'UID:t@test', 'DTSTART:20261122T090000', 'SUMMARY:Задача'].concat('END:VTODO').join('\r\n'),
    vevent('UID:a@test', 'DTSTART:20261124T090000', 'SUMMARY:После блоков'),
  )
  const { events, skipped } = parseIcs(text)
  assert.equal(skipped, 0)
  assert.deepEqual(events.map((e) => e.title), ['После блоков'])
})

test('unknown properties are ignored', () => {
  const { events, skipped } = parseIcs(
    cal(vevent('DTSTART:20261122T090000', 'X-SOMETHING-ODD:value', 'SEQUENCE:3', 'SUMMARY:Встреча')),
  )
  assert.equal(skipped, 0)
  assert.equal(events[0].title, 'Встреча')
})

test('empty and junk input produce nothing, not an exception', () => {
  assert.deepEqual(parseIcs('').events, [])
  assert.deepEqual(parseIcs('   ').events, [])
  assert.deepEqual(parseIcs('совершенно не ics').events, [])
})

test('the calendar name and zone are picked up', () => {
  const text = [
    'BEGIN:VCALENDAR',
    'X-WR-CALNAME:Праздники России',
    'X-WR-TIMEZONE:Europe/Moscow',
    'END:VCALENDAR',
  ].join('\r\n')
  const result = parseIcs(text)
  assert.equal(result.calendarName, 'Праздники России')
  assert.equal(result.timeZone, 'Europe/Moscow')
})

test('RRULE and EXDATE survive the trip in', () => {
  const { events } = parseIcs(
    cal(
      vevent(
        'UID:a@test',
        'DTSTART:20261116T100000',
        'DTEND:20261116T103000',
        'RRULE:FREQ=WEEKLY;BYDAY=MO',
        'EXDATE:20261123T100000,20261130T100000',
      ),
    ),
  )
  assert.equal(events[0].rrule, 'FREQ=WEEKLY;BYDAY=MO')
  assert.deepEqual(events[0].exdates, ['2026-11-23T10:00', '2026-11-30T10:00'])
})

test('RECURRENCE-ID marks an override of one instance', () => {
  const { events } = parseIcs(
    cal(vevent('UID:a@test', 'RECURRENCE-ID:20261123T100000', 'DTSTART:20261123T150000')),
  )
  assert.equal(events[0].originalStart, '2026-11-23T10:00')
})

test('an event with no UID still gets one', () => {
  const { events } = parseIcs(cal(vevent('DTSTART:20261122T090000')))
  assert.ok(events[0].uid.length > 0)
})

/* -------------------------------- writing --------------------------------- */

const event = (over: Partial<CalEvent> = {}): CalEvent => ({
  id: 'e1',
  uid: 'e1@prizma',
  updatedAt: 1,
  calendarId: 'cal-1',
  title: 'Встреча',
  start: '2026-11-22T09:00',
  end: '2026-11-22T10:00',
  allDay: false,
  reminders: [],
  ...over,
})

const FIXED = new Date(Date.UTC(2026, 10, 22, 12, 0, 0))

test('the output is a well-formed calendar with CRLF endings', () => {
  const text = serializeIcs([event()], { now: FIXED })
  assert.ok(text.startsWith('BEGIN:VCALENDAR\r\n'))
  assert.ok(text.trimEnd().endsWith('END:VCALENDAR'))
  assert.ok(text.includes('\r\n'))
  assert.ok(!/[^\r]\n/.test(text), 'every LF must be preceded by CR')
  assert.ok(text.includes('VERSION:2.0'))
  assert.ok(text.includes('UID:e1@prizma'))
  assert.ok(text.includes('DTSTAMP:'))
})

test('no written line exceeds 75 octets', () => {
  const text = serializeIcs(
    [
      event({
        title: 'Совещание по планированию квартала с участием всех руководителей направлений и приглашённых экспертов',
        description: 'Очень длинное описание, которое заведомо не помещается в одну строку и должно быть сложено по правилам RFC 5545.',
      }),
    ],
    { now: FIXED },
  )
  const encoder = new TextEncoder()
  for (const line of text.split('\r\n')) {
    assert.ok(encoder.encode(line).length <= 75, `too long (${encoder.encode(line).length}): ${line}`)
  }
})

test('folding never splits a character in half', () => {
  const folded = fold(`SUMMARY:${'я'.repeat(80)}`)
  // Re-joining must give back exactly what went in.
  assert.equal(folded.split('\r\n ').join(''), `SUMMARY:${'я'.repeat(80)}`)
})

test('a short line is not folded', () => {
  assert.equal(fold('SUMMARY:Короткая'), 'SUMMARY:Короткая')
})

test('all-day events are written with VALUE=DATE', () => {
  const text = serializeIcs([event({ allDay: true, start: '2026-11-22', end: '2026-11-24' })], { now: FIXED })
  assert.ok(text.includes('DTSTART;VALUE=DATE:20261122'))
  assert.ok(text.includes('DTEND;VALUE=DATE:20261124'))
})

test('deleted events are not exported', () => {
  const text = serializeIcs([event(), event({ id: 'e2', uid: 'e2@prizma', deletedAt: Date.now() })], { now: FIXED })
  assert.equal(text.match(/BEGIN:VEVENT/g)?.length, 1)
})

/* ------------------------------- round trip ------------------------------- */

test('parse(serialize(x)) gives back the same events', () => {
  const originals = [
    event({ title: 'Обычная встреча' }),
    event({ id: 'e2', uid: 'e2@prizma', title: 'Весь день', allDay: true, start: '2026-11-22', end: '2026-11-25' }),
    event({
      id: 'e3',
      uid: 'e3@prizma',
      title: 'Серия, с запятой; и точкой',
      description: 'Строка один\nстрока два',
      location: 'Переговорная 3',
      start: '2026-11-16T10:00',
      end: '2026-11-16T10:30',
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      exdates: ['2026-11-23T10:00'],
    }),
  ]

  const { events, skipped } = parseIcs(serializeIcs(originals, { now: FIXED }))
  assert.equal(skipped, 0)
  assert.equal(events.length, originals.length)

  for (const [i, original] of originals.entries()) {
    const parsed = events[i]
    assert.equal(parsed.uid, original.uid)
    assert.equal(parsed.title, original.title)
    assert.equal(parsed.start, original.start)
    assert.equal(parsed.end, original.end)
    assert.equal(parsed.allDay, original.allDay)
    assert.equal(parsed.rrule, original.rrule)
    assert.deepEqual(parsed.exdates, original.exdates)
    assert.equal(parsed.location, original.location)
    assert.equal(parsed.description, original.description)
  }
})

test('a long title survives the fold and unfold round trip', () => {
  const title = 'Совещание по планированию квартала с участием всех руководителей направлений'
  const { events } = parseIcs(serializeIcs([event({ title })], { now: FIXED }))
  assert.equal(events[0].title, title)
})

test('the export filename is safe and dated', () => {
  assert.match(icsFileName({ name: 'Личное' }), /^Личное-\d{4}-\d{2}-\d{2}\.ics$/)
  assert.match(icsFileName({ name: 'Работа / проекты' }), /^Работа-проекты-/)
  assert.match(icsFileName(), /^prizma-/)
})
