/**
 * iCalendar (RFC 5545) in and out.
 *
 * The guiding rule for reading: **a broken record is skipped, parsing
 * continues.** One malformed VEVENT in a feed of five hundred must not cost
 * the user the other 499 — so nothing here throws on bad input, and the count
 * of what was skipped is returned for the UI to show.
 *
 * The fiddly parts, all of which break naive parsers:
 *   - lines are folded at 75 octets and continued with a leading space/tab
 *   - line endings may be CRLF, LF or bare CR
 *   - TEXT values escape \n \, \; \\
 *   - a property is `NAME;PARAM=value:VALUE` — the value starts at the first
 *     colon *outside quotes*, not the first colon
 *   - DTEND is exclusive, and for all-day events it is already the day after
 *   - TZID means a wall clock in another zone, not UTC
 */

import * as dt from './datetime.ts'
import { parseIcsStamp, toIcsStamp } from './recurrence.ts'
import type { Local } from './datetime.ts'
import type { CalEvent, Calendar, Reminder } from './types.ts'

export const PRODID = '-//Prizma//Calendar 0.1//RU'

/** Default length for an event that arrives with neither DTEND nor DURATION. */
const FALLBACK_MINUTES = 60

export interface ParsedEvent {
  uid: string
  title: string
  description?: string
  location?: string
  start: Local
  end: Local
  allDay: boolean
  rrule?: string
  exdates?: Local[]
  reminders: Reminder[]
  /** From RECURRENCE-ID: this record overrides one instance of a series. */
  originalStart?: Local
}

export interface ParseResult {
  events: ParsedEvent[]
  /** Records that could not be read. Shown to the user rather than hidden. */
  skipped: number
  /** X-WR-CALNAME, which most publishers set. */
  calendarName?: string
  /** X-WR-TIMEZONE, used as the fallback zone for floating times. */
  timeZone?: string
}

/* --------------------------------- reading -------------------------------- */

/** Split into logical lines, undoing RFC 5545 folding. */
export function unfold(text: string): string[] {
  const raw = text.replace(/\r\n|\r/g, '\n').split('\n')
  const out: string[] = []
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) {
      out[out.length - 1] += line.slice(1)
    } else if (line.length) {
      out.push(line)
    }
  }
  return out
}

export interface ContentLine {
  name: string
  params: Map<string, string>
  value: string
}

/**
 * Split one content line. The value begins at the first colon that is not
 * inside a quoted parameter — `DTSTART;TZID="Europe/Berlin":2026…` would
 * otherwise be cut in the wrong place.
 */
export function parseContentLine(line: string): ContentLine | null {
  let colon = -1
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') quoted = !quoted
    else if (c === ':' && !quoted) {
      colon = i
      break
    }
  }
  if (colon <= 0) return null

  const head = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const pieces = splitUnquoted(head, ';')
  const name = (pieces.shift() ?? '').toUpperCase()
  if (!name) return null

  const params = new Map<string, string>()
  for (const piece of pieces) {
    const eq = piece.indexOf('=')
    if (eq <= 0) continue
    params.set(piece.slice(0, eq).toUpperCase(), unquote(piece.slice(eq + 1)))
  }

  return { name, params, value }
}

function splitUnquoted(text: string, separator: string): string[] {
  const out: string[] = []
  let current = ''
  let quoted = false
  for (const c of text) {
    if (c === '"') quoted = !quoted
    if (c === separator && !quoted) {
      out.push(current)
      current = ''
    } else {
      current += c
    }
  }
  out.push(current)
  return out
}

function unquote(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value
}

/** Undo TEXT escaping. */
export function unescapeText(value: string): string {
  let out = ''
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== '\\') {
      out += value[i]
      continue
    }
    const next = value[++i]
    if (next === 'n' || next === 'N') out += '\n'
    else if (next === undefined) out += '\\'
    else out += next // covers \, \; \\ and anything else, verbatim
  }
  return out
}

/** An ISO 8601 duration as minutes. Returns null for an unreadable one. */
export function parseDuration(value: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim())
  if (!m) return null
  const [, sign, weeks, days, hours, minutes, seconds] = m
  if (!weeks && !days && !hours && !minutes && !seconds) return null
  const total =
    (+(weeks ?? 0) * 7 + +(days ?? 0)) * 1440 + +(hours ?? 0) * 60 + +(minutes ?? 0) + +(seconds ?? 0) / 60
  return sign === '-' ? -Math.round(total) : Math.round(total)
}

/**
 * A date-time property as a local wall clock.
 *
 * Three forms: UTC (trailing Z), a zone named by TZID, and a floating time
 * with neither — the last is already a wall clock and is taken as written.
 */
export function readDateTime(line: ContentLine, fallbackZone?: string): Local | null {
  const value = line.value.trim()
  const isDate = line.params.get('VALUE')?.toUpperCase() === 'DATE' || /^\d{8}$/.test(value)
  if (isDate) {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(value)
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null
  }

  if (value.endsWith('Z')) return parseIcsStamp(value)

  const zone = line.params.get('TZID') ?? fallbackZone
  const floating = parseIcsStamp(value)
  if (!floating || !zone) return floating
  return shiftZone(floating, zone)
}

/**
 * Re-read a wall clock stated in `zone` as a wall clock here.
 *
 * Two passes: the first offset is looked up at the naive instant, the second
 * at the corrected one. Near a DST change the two differ, and a single pass
 * lands an hour out.
 */
export function shiftZone(wall: Local, zone: string): Local {
  const p = dt.parse(wall)
  const naive = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi)
  try {
    let instant = naive - offsetOf(new Date(naive), zone)
    instant = naive - offsetOf(new Date(instant), zone)
    return dt.fromDate(new Date(instant))
  } catch {
    // An unknown TZID is better treated as floating than dropped.
    return wall
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>()

/** The zone's offset from UTC at `date`, in milliseconds. */
function offsetOf(date: Date, zone: string): number {
  let formatter = formatters.get(zone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(zone, formatter)
  }
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]))
  const asUtc = Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    // Some locales render midnight as hour 24.
    +parts.hour % 24,
    +parts.minute,
    +parts.second,
  )
  return asUtc - date.getTime()
}

/** Blocks whose contents must not be mistaken for an event's properties. */
const SKIPPED_BLOCKS = new Set(['VALARM', 'VTODO', 'VJOURNAL', 'VFREEBUSY', 'VTIMEZONE'])

export function parseIcs(text: string): ParseResult {
  const result: ParseResult = { events: [], skipped: 0 }
  if (!text || !text.trim()) return result

  const lines = unfold(text)
  let current: Map<string, ContentLine[]> | null = null
  /** Nesting depth inside a block we are ignoring. */
  let skipDepth = 0

  for (const raw of lines) {
    const line = parseContentLine(raw)
    if (!line) continue

    if (line.name === 'BEGIN') {
      const block = line.value.trim().toUpperCase()
      if (skipDepth > 0 || SKIPPED_BLOCKS.has(block)) {
        skipDepth++
        continue
      }
      if (block === 'VEVENT') current = new Map()
      continue
    }

    if (line.name === 'END') {
      if (skipDepth > 0) {
        skipDepth--
        continue
      }
      if (line.value.trim().toUpperCase() === 'VEVENT' && current) {
        const event = buildEvent(current, result.timeZone)
        if (event) result.events.push(event)
        else result.skipped++
        current = null
      }
      continue
    }

    if (skipDepth > 0) continue

    if (!current) {
      // Calendar-level properties.
      if (line.name === 'X-WR-CALNAME') result.calendarName = unescapeText(line.value).trim()
      if (line.name === 'X-WR-TIMEZONE') result.timeZone = line.value.trim()
      continue
    }

    const bucket = current.get(line.name)
    if (bucket) bucket.push(line)
    else current.set(line.name, [line])
  }

  // An unterminated VEVENT at the end of the file counts as skipped, not lost.
  if (current) result.skipped++

  return result
}

function buildEvent(props: Map<string, ContentLine[]>, fallbackZone?: string): ParsedEvent | null {
  const first = (name: string) => props.get(name)?.[0]
  const text = (name: string) => {
    const line = first(name)
    return line ? unescapeText(line.value).trim() : undefined
  }

  const dtstart = first('DTSTART')
  if (!dtstart) return null
  const start = readDateTime(dtstart, fallbackZone)
  if (!start) return null

  const allDay = !dt.hasTime(start)

  let end: Local | null = null
  const dtend = first('DTEND')
  if (dtend) {
    end = readDateTime(dtend, fallbackZone)
  } else {
    const duration = first('DURATION')
    const minutes = duration ? parseDuration(duration.value) : null
    if (minutes != null && minutes > 0) {
      end = allDay ? dt.dateOf(dt.addDays(start, Math.max(1, Math.round(minutes / 1440)))) : dt.addMinutes(start, minutes)
    }
  }
  if (!end) {
    // DTEND is exclusive, so a bare all-day event covers exactly its one day.
    end = allDay ? dt.dateOf(dt.addDays(start, 1)) : dt.addMinutes(start, FALLBACK_MINUTES)
  }
  // Defend against files where DTEND precedes DTSTART.
  if (end <= start) {
    end = allDay ? dt.dateOf(dt.addDays(start, 1)) : dt.addMinutes(start, FALLBACK_MINUTES)
  }

  const exdates: Local[] = []
  for (const line of props.get('EXDATE') ?? []) {
    for (const piece of line.value.split(',')) {
      const parsed = readDateTime({ ...line, value: piece }, fallbackZone)
      if (parsed) exdates.push(parsed)
    }
  }

  const recurrenceId = first('RECURRENCE-ID')
  const originalStart = recurrenceId ? (readDateTime(recurrenceId, fallbackZone) ?? undefined) : undefined

  return {
    uid: text('UID') || `${crypto.randomUUID()}@imported`,
    title: text('SUMMARY') ?? '',
    description: text('DESCRIPTION') || undefined,
    location: text('LOCATION') || undefined,
    start,
    end,
    allDay,
    rrule: first('RRULE')?.value.trim() || undefined,
    exdates: exdates.length ? exdates : undefined,
    // VALARM is skipped wholesale, so imported events carry no reminders.
    reminders: [],
    originalStart,
  }
}

/* --------------------------------- writing -------------------------------- */

/** Escape a TEXT value. Order matters: backslashes first. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

/**
 * Fold a line at 75 octets, counting UTF-8 bytes rather than characters —
 * folding mid-character would corrupt Cyrillic text.
 */
export function fold(line: string): string {
  const encoder = new TextEncoder()
  if (encoder.encode(line).length <= 75) return line

  const out: string[] = []
  let current = ''
  let bytes = 0
  // The continuation space counts toward the next line's 75.
  let limit = 75

  for (const char of line) {
    const size = encoder.encode(char).length
    if (bytes + size > limit) {
      out.push(current)
      current = ''
      bytes = 1
      limit = 75
    }
    current += char
    bytes += size
  }
  if (current) out.push(current)
  return out.join('\r\n ')
}

function line(name: string, value: string): string {
  return fold(`${name}:${value}`)
}

export interface SerializeOptions {
  calendarName?: string
  /** Fixed stamp, so a round-trip test is not at the mercy of the clock. */
  now?: Date
}

/**
 * Write events as an iCalendar file.
 *
 * Times are written as floating local values — no TZID, no Z. That is exactly
 * what the app stores, and it is what "09:00 wherever I am" means. Declaring a
 * zone we never recorded would be a guess dressed up as data.
 */
export function serializeIcs(events: CalEvent[], options: SerializeOptions = {}): string {
  const stamp = toIcsStamp(dt.fromDate(options.now ?? new Date()), true)
  const out: string[] = ['BEGIN:VCALENDAR', `PRODID:${PRODID}`, 'VERSION:2.0', 'CALSCALE:GREGORIAN']
  if (options.calendarName) out.push(line('X-WR-CALNAME', escapeText(options.calendarName)))

  for (const event of events) {
    if (event.deletedAt != null) continue
    const dateParam = event.allDay ? ';VALUE=DATE' : ''
    out.push('BEGIN:VEVENT')
    out.push(line('UID', event.uid))
    out.push(line('DTSTAMP', stamp))
    out.push(fold(`DTSTART${dateParam}:${toIcsStamp(event.start)}`))
    out.push(fold(`DTEND${dateParam}:${toIcsStamp(event.end)}`))
    if (event.title) out.push(line('SUMMARY', escapeText(event.title)))
    if (event.description) out.push(line('DESCRIPTION', escapeText(event.description)))
    if (event.location) out.push(line('LOCATION', escapeText(event.location)))
    if (event.rrule) out.push(line('RRULE', event.rrule))
    for (const exdate of event.exdates ?? []) {
      out.push(fold(`EXDATE${dateParam}:${toIcsStamp(exdate)}`))
    }
    if (event.originalStart) {
      out.push(fold(`RECURRENCE-ID${dateParam}:${toIcsStamp(event.originalStart)}`))
    }
    out.push('END:VEVENT')
  }

  out.push('END:VCALENDAR')
  // RFC 5545 requires CRLF, and some importers are strict about it.
  return out.join('\r\n') + '\r\n'
}

/** A filename that will not surprise anyone on Windows. */
export function icsFileName(calendar?: Pick<Calendar, 'name'>): string {
  const base = (calendar?.name ?? 'prizma').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '')
  return `${base || 'prizma'}-${dt.today()}.ics`
}
