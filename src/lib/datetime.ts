/**
 * Wall-clock date/time utilities.
 *
 * The whole app stores times as *local wall-clock strings* with no offset:
 *   - date-time: "2026-11-22T09:30"
 *   - date only: "2026-11-22"
 *
 * Why: "every Monday at 09:00" must stay 09:00 across a DST change. If we
 * stored absolute instants, expanding a weekly rule would drift by an hour
 * twice a year. Working on y/m/d/h/m components makes that class of bug
 * impossible, and we only materialise a real `Date` at the edges (rendering,
 * notifications, ICS export).
 */

export type LocalDate = string // YYYY-MM-DD
export type LocalDateTime = string // YYYY-MM-DDTHH:mm
/** Either of the two above. `allDay` on the record tells you which. */
export type Local = string

export interface Parts {
  y: number
  m: number // 1-12
  d: number // 1-31
  h: number // 0-23
  mi: number // 0-59
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

export function parse(local: Local): Parts {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(local)
  if (!m) throw new Error(`Not a local date/time: ${JSON.stringify(local)}`)
  // Reject a value that carries a time we could not read, instead of quietly
  // treating it as midnight: a malformed stamp from an imported file would
  // otherwise move the event to the start of the day with nothing to show for
  // it. Trailing seconds are fine; anything else is not.
  if (!m[4] && local.length > 10) {
    throw new Error(`Unreadable time in local date/time: ${JSON.stringify(local)}`)
  }
  return {
    y: +m[1],
    m: +m[2],
    d: +m[3],
    h: m[4] ? +m[4] : 0,
    mi: m[5] ? +m[5] : 0,
  }
}

export function formatParts(p: Parts, dateOnly = false): Local {
  const date = `${pad(p.y, 4)}-${pad(p.m)}-${pad(p.d)}`
  return dateOnly ? date : `${date}T${pad(p.h)}:${pad(p.mi)}`
}

/** Strip the time component: "2026-11-22T09:30" -> "2026-11-22". */
export function dateOf(local: Local): LocalDate {
  return local.slice(0, 10)
}

/** "09:30" from "2026-11-22T09:30"; "" for a date-only value. */
export function timeOf(local: Local): string {
  return local.length > 10 ? local.slice(11, 16) : ''
}

export function hasTime(local: Local): boolean {
  return local.length > 10
}

/** Materialise a real instant in the user's current zone. */
export function toDate(local: Local): Date {
  const p = parse(local)
  return new Date(p.y, p.m - 1, p.d, p.h, p.mi, 0, 0)
}

export function fromDate(d: Date, dateOnly = false): Local {
  return formatParts(
    { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes() },
    dateOnly,
  )
}

export function now(): LocalDateTime {
  return fromDate(new Date())
}

export function today(): LocalDate {
  return fromDate(new Date(), true)
}

/* ------------------------------- arithmetic ------------------------------- */

/** Calendar-day arithmetic: the time of day is preserved exactly. */
export function addDays(local: Local, days: number): Local {
  const p = parse(local)
  const d = new Date(p.y, p.m - 1, p.d + days, 12) // noon avoids DST edges
  return formatParts({ y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), h: p.h, mi: p.mi }, !hasTime(local))
}

/**
 * Month arithmetic, clamped to the end of the target month so that
 * Jan 31 + 1 month is Feb 28/29 rather than spilling into March.
 */
export function addMonths(local: Local, months: number): Local {
  const p = parse(local)
  const total = p.y * 12 + (p.m - 1) + months
  const y = Math.floor(total / 12)
  const m = (total % 12) + 1
  const d = Math.min(p.d, daysInMonth(y, m))
  return formatParts({ ...p, y, m, d }, !hasTime(local))
}

export function addYears(local: Local, years: number): Local {
  return addMonths(local, years * 12)
}

/** Minute arithmetic goes through a real instant, so it respects DST. */
export function addMinutes(local: Local, minutes: number): LocalDateTime {
  const d = toDate(local)
  d.setMinutes(d.getMinutes() + minutes)
  return fromDate(d)
}

export function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate()
}

/** Whole days between two calendar dates (b - a). */
export function diffDays(a: Local, b: Local): number {
  const pa = parse(a)
  const pb = parse(b)
  const da = Date.UTC(pa.y, pa.m - 1, pa.d)
  const db = Date.UTC(pb.y, pb.m - 1, pb.d)
  return Math.round((db - da) / 86_400_000)
}

/** Elapsed minutes between two local times (b - a), DST-aware. */
export function diffMinutes(a: Local, b: Local): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 60_000)
}

/** Minutes since midnight. */
export function minutesOfDay(local: Local): number {
  const p = parse(local)
  return p.h * 60 + p.mi
}

export function withTime(local: Local, minutesFromMidnight: number): LocalDateTime {
  const p = parse(local)
  const mins = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutesFromMidnight)))
  return formatParts({ ...p, h: Math.floor(mins / 60), mi: mins % 60 })
}

/** Snap a minute count to the nearest `step` (used while dragging). */
export function snap(minutes: number, step = 15): number {
  return Math.round(minutes / step) * step
}

/* -------------------------------- calendars ------------------------------- */

export type WeekStart = 0 | 1 // Sunday | Monday

/** 0 = Sunday … 6 = Saturday */
export function weekday(local: Local): number {
  const p = parse(local)
  return new Date(p.y, p.m - 1, p.d).getDay()
}

export function startOfWeek(local: Local, weekStart: WeekStart = 1): LocalDate {
  const wd = weekday(local)
  const back = (wd - weekStart + 7) % 7
  return dateOf(addDays(dateOf(local), -back))
}

export function startOfMonth(local: Local): LocalDate {
  const p = parse(local)
  return formatParts({ ...p, d: 1 }, true)
}

export function endOfMonth(local: Local): LocalDate {
  const p = parse(local)
  return formatParts({ ...p, d: daysInMonth(p.y, p.m) }, true)
}

/** The 6×7 grid a month view shows, always 42 days for a stable layout. */
export function monthGrid(local: Local, weekStart: WeekStart = 1): LocalDate[] {
  const first = startOfWeek(startOfMonth(local), weekStart)
  return Array.from({ length: 42 }, (_, i) => dateOf(addDays(first, i)))
}

export function weekDates(local: Local, weekStart: WeekStart = 1): LocalDate[] {
  const first = startOfWeek(local, weekStart)
  return Array.from({ length: 7 }, (_, i) => dateOf(addDays(first, i)))
}

export function isSameDay(a: Local, b: Local): boolean {
  return dateOf(a) === dateOf(b)
}

export function isToday(local: Local): boolean {
  return dateOf(local) === today()
}

export function isWeekend(local: Local): boolean {
  const wd = weekday(local)
  return wd === 0 || wd === 6
}

/** Inclusive list of dates from `a` to `b`. */
export function datesBetween(a: Local, b: Local): LocalDate[] {
  const n = diffDays(a, b)
  if (n < 0) return []
  return Array.from({ length: n + 1 }, (_, i) => dateOf(addDays(dateOf(a), i)))
}

/** Half-open overlap test: [aStart, aEnd) vs [bStart, bEnd). */
export function overlaps(aStart: Local, aEnd: Local, bStart: Local, bEnd: Local): boolean {
  return aStart < bEnd && bStart < aEnd
}

/* ------------------------------- formatting ------------------------------- */

let locale = typeof navigator !== 'undefined' ? navigator.language || 'ru-RU' : 'ru-RU'

export function setLocale(l: string) {
  locale = l
  cache.clear()
}

export function getLocale() {
  return locale
}

const cache = new Map<string, Intl.DateTimeFormat>()
function fmt(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = locale + JSON.stringify(opts)
  let f = cache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(locale, opts)
    cache.set(key, f)
  }
  return f
}

export function formatTime(local: Local): string {
  return fmt({ hour: '2-digit', minute: '2-digit' }).format(toDate(local))
}

export function formatDate(local: Local): string {
  return fmt({ day: 'numeric', month: 'long', year: 'numeric' }).format(toDate(local))
}

export function formatDateShort(local: Local): string {
  return fmt({ day: 'numeric', month: 'short' }).format(toDate(local))
}

export function formatMonthYear(local: Local): string {
  return fmt({ month: 'long', year: 'numeric' }).format(toDate(local))
}

export function formatWeekdayShort(local: Local): string {
  return fmt({ weekday: 'short' }).format(toDate(local))
}

export function formatWeekdayLong(local: Local): string {
  return fmt({ weekday: 'long' }).format(toDate(local))
}

/** Localised weekday headers for a grid, honouring the week start. */
export function weekdayHeaders(weekStart: WeekStart = 1): string[] {
  // 2026-11-22 is a Sunday, so it is a convenient anchor for index 0.
  const sunday = '2026-11-22'
  return Array.from({ length: 7 }, (_, i) => formatWeekdayShort(addDays(sunday, (i + weekStart) % 7)))
}

/** "сегодня" / "завтра" / "22 нояб." for compact labels. */
export function formatRelativeDay(local: Local): string {
  const delta = diffDays(today(), local)
  if (delta === 0) return relative(0, 'day')
  if (delta === 1) return relative(1, 'day')
  if (delta === -1) return relative(-1, 'day')
  return formatDateShort(local)
}

const rtfCache = new Map<string, Intl.RelativeTimeFormat>()
function relative(value: number, unit: Intl.RelativeTimeFormatUnit): string {
  let rtf = rtfCache.get(locale)
  if (!rtf) {
    rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    rtfCache.set(locale, rtf)
  }
  return rtf.format(value, unit)
}

/** "09:00 – 10:30" or "22 нояб. 09:00 – 23 нояб. 11:00" when it spans days. */
export function formatRange(start: Local, end: Local, allDay = false): string {
  if (allDay) {
    const days = diffDays(start, end)
    return days <= 1 ? formatDate(start) : `${formatDateShort(start)} – ${formatDateShort(addDays(end, -1))}`
  }
  if (isSameDay(start, end)) return `${formatTime(start)} – ${formatTime(end)}`
  return `${formatDateShort(start)} ${formatTime(start)} – ${formatDateShort(end)} ${formatTime(end)}`
}

export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  const h = Math.floor(m / 60)
  const rest = m % 60
  if (h && rest) return `${h} ч ${rest} мин`
  if (h) return `${h} ч`
  return `${rest} мин`
}
