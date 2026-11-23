/**
 * RFC 5545 recurrence, expanded over wall-clock components.
 *
 * Supported: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL, COUNT, UNTIL,
 * BYDAY (with ordinals like 2MO / -1FR), BYMONTHDAY (negative = from the end
 * of the month), BYMONTH, BYSETPOS, WKST, and EXDATE.
 *
 * Deliberately not supported: BYWEEKNO, BYYEARDAY, BYHOUR/BYMINUTE/BYSECOND.
 * Those are vanishingly rare in real calendars; a rule using them still
 * parses and expands, ignoring those parts, rather than throwing.
 */

import * as dt from './datetime.ts'
import type { Local, LocalDate } from './datetime.ts'

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'

export interface ByDay {
  /** 0 = Sunday … 6 = Saturday */
  day: number
  /** 1 = first, -1 = last … only meaningful for MONTHLY/YEARLY. */
  ord?: number
}

export interface Rule {
  freq: Freq
  interval: number
  count?: number
  until?: Local
  byDay?: ByDay[]
  byMonthDay?: number[]
  byMonth?: number[]
  bySetPos?: number[]
  weekStart: 0 | 1
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const

/** Guards against a pathological rule locking up the UI. */
const MAX_PERIODS = 3650
const MAX_RESULTS = 2000

/**
 * Test seam. Counts how many candidate starts `expand` had to look at, which
 * is the only observable evidence that the fast-forward is working: a daily
 * series begun in 2000 must cost tens of candidates to render a month of 2026,
 * not thousands. Reset it, run a query, assert the count.
 */
export const stats = { candidatesExamined: 0 }

/* --------------------------------- parsing -------------------------------- */

export function parseRule(rrule: string): Rule | null {
  if (!rrule) return null
  // Tolerate a full "RRULE:FREQ=..." line as well as a bare body.
  const body = rrule.replace(/^RRULE:/i, '').trim()
  if (!body) return null

  const parts = new Map<string, string>()
  for (const chunk of body.split(';')) {
    const i = chunk.indexOf('=')
    if (i <= 0) continue
    parts.set(chunk.slice(0, i).toUpperCase(), chunk.slice(i + 1))
  }

  const freq = (parts.get('FREQ') ?? '').toUpperCase()
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null

  const rule: Rule = {
    freq,
    interval: clampInt(parts.get('INTERVAL'), 1, 1, 1000),
    weekStart: (parts.get('WKST') ?? '').toUpperCase() === 'SU' ? 0 : 1,
  }

  const count = parts.get('COUNT')
  if (count && Number.isFinite(+count) && +count > 0) rule.count = Math.min(+count, MAX_RESULTS)

  const until = parts.get('UNTIL')
  if (until) {
    const parsed = parseIcsStamp(until)
    if (parsed) rule.until = parsed
  }

  const byDay = parts.get('BYDAY')
  if (byDay) {
    const days: ByDay[] = []
    for (const token of byDay.split(',')) {
      const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(token.trim())
      if (!m) continue
      const day = DAY_CODES.indexOf(m[2].toUpperCase() as (typeof DAY_CODES)[number])
      days.push(m[1] ? { day, ord: +m[1] } : { day })
    }
    if (days.length) rule.byDay = days
  }

  const byMonthDay = parts.get('BYMONTHDAY')
  if (byMonthDay) {
    const days = byMonthDay
      .split(',')
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isInteger(n) && n !== 0 && n >= -31 && n <= 31)
    if (days.length) rule.byMonthDay = days
  }

  const byMonth = parts.get('BYMONTH')
  if (byMonth) {
    const months = byMonth
      .split(',')
      .map((s) => parseInt(s, 10))
      .filter((n) => n >= 1 && n <= 12)
    if (months.length) rule.byMonth = months
  }

  const bySetPos = parts.get('BYSETPOS')
  if (bySetPos) {
    const pos = bySetPos
      .split(',')
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isInteger(n) && n !== 0)
    if (pos.length) rule.bySetPos = pos
  }

  return rule
}

export function serializeRule(rule: Rule): string {
  const out: string[] = [`FREQ=${rule.freq}`]
  if (rule.interval > 1) out.push(`INTERVAL=${rule.interval}`)
  if (rule.byDay?.length) {
    out.push(`BYDAY=${rule.byDay.map((b) => `${b.ord ?? ''}${DAY_CODES[b.day]}`).join(',')}`)
  }
  if (rule.byMonthDay?.length) out.push(`BYMONTHDAY=${rule.byMonthDay.join(',')}`)
  if (rule.byMonth?.length) out.push(`BYMONTH=${rule.byMonth.join(',')}`)
  if (rule.bySetPos?.length) out.push(`BYSETPOS=${rule.bySetPos.join(',')}`)
  if (rule.count) out.push(`COUNT=${rule.count}`)
  if (rule.until) out.push(`UNTIL=${toIcsStamp(rule.until)}`)
  if (rule.weekStart === 0) out.push('WKST=SU')
  return out.join(';')
}

function clampInt(v: string | undefined, fallback: number, min: number, max: number): number {
  const n = v == null ? NaN : parseInt(v, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** "20261231T235959Z" or "20261231" -> local wall clock. */
export function parseIcsStamp(raw: string): Local | null {
  const s = raw.trim()
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(s)
  if (!m) return null
  const [, y, mo, d, h, mi, , z] = m
  if (!h) return `${y}-${mo}-${d}`
  if (z) {
    // UTC instant -> the user's wall clock.
    const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, 0))
    return dt.fromDate(date)
  }
  return `${y}-${mo}-${d}T${h}:${mi}`
}

/** Local wall clock -> an ICS stamp. Date-only stays date-only. */
export function toIcsStamp(local: Local, utc = false): string {
  if (!dt.hasTime(local)) return local.replace(/-/g, '')
  if (utc) {
    const d = dt.toDate(local)
    const p = (n: number) => String(n).padStart(2, '0')
    return (
      `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
      `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
    )
  }
  return `${local.slice(0, 10).replace(/-/g, '')}T${local.slice(11, 16).replace(':', '')}00`
}

/* -------------------------------- expansion ------------------------------- */

export interface ExpandOptions {
  /** Only yield occurrences that start before this (exclusive). */
  rangeEnd?: Local
  /** Drop occurrences ending before this. */
  rangeStart?: Local
  /** Occurrence starts to skip. */
  exdates?: Local[]
  /** Duration in minutes, used for the `rangeStart` overlap test. */
  durationMinutes?: number
  limit?: number
}

/**
 * Expand a series into occurrence start times, ascending.
 *
 * COUNT and UNTIL are evaluated from `dtstart` regardless of `rangeStart`,
 * which is what the spec requires: the 10th occurrence is the 10th from the
 * beginning, not the 10th one you happen to be looking at.
 */
export function expand(dtstart: Local, rrule: string | Rule | undefined, opts: ExpandOptions = {}): Local[] {
  const rule = typeof rrule === 'string' ? parseRule(rrule) : (rrule ?? null)
  const dateOnly = !dt.hasTime(dtstart)
  const duration = opts.durationMinutes ?? 0
  const exdates = new Set(opts.exdates ?? [])

  // A single event: the only candidate is dtstart itself.
  if (!rule) {
    if (exdates.has(dtstart)) return []
    if (!inRange(dtstart, duration, dateOnly, opts)) return []
    return [dtstart]
  }

  const limit = Math.min(opts.limit ?? MAX_RESULTS, MAX_RESULTS)
  const results: Local[] = []
  let emitted = 0 // counts toward COUNT, including occurrences before rangeStart

  // When COUNT is set, every occurrence from the start has to be counted, so
  // we cannot skip ahead. Otherwise jump straight to the asked-for window —
  // without this, a daily event from five years ago costs ~1800 iterations
  // on every single render. Back the target off by the event's own length so
  // an occurrence that starts earlier but still overlaps is not skipped.
  const skipBefore =
    rule.count == null && opts.rangeStart
      ? dt.dateOf(dt.addDays(opts.rangeStart, -(Math.ceil(duration / 1440) + 1)))
      : undefined

  for (const candidate of candidates(dtstart, rule, skipBefore)) {
    stats.candidatesExamined++
    if (rule.count != null && emitted >= rule.count) break
    if (rule.until && candidate > normaliseUntil(rule.until, dateOnly)) break
    if (opts.rangeEnd && candidate >= opts.rangeEnd && (rule.count == null)) break

    emitted++

    if (exdates.has(candidate)) continue
    if (opts.rangeEnd && candidate >= opts.rangeEnd) continue
    if (!inRange(candidate, duration, dateOnly, opts)) continue

    results.push(candidate)
    if (results.length >= limit) break
  }

  return results
}

function normaliseUntil(until: Local, dateOnly: boolean): Local {
  if (dateOnly) return dt.dateOf(until)
  // A date-only UNTIL covers the whole day.
  return dt.hasTime(until) ? until : `${until}T23:59`
}

function inRange(start: Local, durationMinutes: number, dateOnly: boolean, opts: ExpandOptions): boolean {
  if (!opts.rangeStart) return true
  const end = dateOnly
    ? dt.addDays(start, Math.max(1, Math.round(durationMinutes / 1440)))
    : dt.addMinutes(start, durationMinutes)
  return end > opts.rangeStart
}

/**
 * Lazily yield candidate starts in ascending order, before filtering.
 *
 * `skipBefore` is a pure optimisation: it advances the period cursor to the
 * last period that can still contain a date >= skipBefore. It must never be
 * passed when COUNT is in play, since the count runs from dtstart.
 */
function* candidates(dtstart: Local, rule: Rule, skipBefore?: Local): Generator<Local> {
  const p = dt.parse(dtstart)
  const dateOnly = !dt.hasTime(dtstart)
  const time = dateOnly ? '' : dtstart.slice(10) // "T09:30"
  const at = (date: LocalDate): Local => (dateOnly ? date : `${date}${time}`)
  /** Whole periods to jump, never negative. */
  const jump = (periodsElapsed: number) => Math.max(0, Math.floor(periodsElapsed / rule.interval)) * rule.interval

  switch (rule.freq) {
    case 'DAILY': {
      let date = dt.dateOf(dtstart)
      if (skipBefore && skipBefore > date) date = dt.dateOf(dt.addDays(date, jump(dt.diffDays(date, skipBefore))))
      for (let i = 0; i < MAX_PERIODS; i++) {
        if (matchesFilters(date, rule)) yield at(date)
        date = dt.dateOf(dt.addDays(date, rule.interval))
      }
      return
    }

    case 'WEEKLY': {
      const days = (rule.byDay?.length ? rule.byDay.map((b) => b.day) : [dt.weekday(dtstart)])
        .slice()
        .sort((a, b) => offsetInWeek(a, rule.weekStart) - offsetInWeek(b, rule.weekStart))
      let weekStartDate = dt.startOfWeek(dtstart, rule.weekStart)
      if (skipBefore) {
        const target = dt.startOfWeek(skipBefore, rule.weekStart)
        if (target > weekStartDate) {
          const weeks = dt.diffDays(weekStartDate, target) / 7
          weekStartDate = dt.dateOf(dt.addDays(weekStartDate, jump(weeks) * 7))
        }
      }
      for (let i = 0; i < MAX_PERIODS; i++) {
        for (const day of days) {
          const date = dt.dateOf(dt.addDays(weekStartDate, offsetInWeek(day, rule.weekStart)))
          if (date < dt.dateOf(dtstart)) continue // the first week may start mid-week
          if (matchesFilters(date, rule)) yield at(date)
        }
        weekStartDate = dt.dateOf(dt.addDays(weekStartDate, 7 * rule.interval))
      }
      return
    }

    case 'MONTHLY': {
      let cursor = `${dtstart.slice(0, 7)}-01`
      if (skipBefore) {
        const target = `${skipBefore.slice(0, 7)}-01`
        if (target > cursor) {
          const pt = dt.parse(target)
          const months = (pt.y - p.y) * 12 + (pt.m - p.m)
          cursor = dt.dateOf(dt.addMonths(cursor, jump(months)))
        }
      }
      for (let i = 0; i < MAX_PERIODS; i++) {
        const pc = dt.parse(cursor)
        for (const date of datesInMonth(pc.y, pc.m, rule, p.d)) {
          if (date < dt.dateOf(dtstart)) continue
          yield at(date)
        }
        cursor = dt.dateOf(dt.addMonths(cursor, rule.interval))
      }
      return
    }

    case 'YEARLY': {
      let year = p.y
      if (skipBefore) {
        const targetYear = dt.parse(skipBefore).y
        if (targetYear > year) year += jump(targetYear - year)
      }
      const months = rule.byMonth?.length ? [...rule.byMonth].sort((a, b) => a - b) : [p.m]
      for (let i = 0; i < MAX_PERIODS; i++) {
        for (const month of months) {
          for (const date of datesInMonth(year, month, rule, p.d)) {
            if (date < dt.dateOf(dtstart)) continue
            yield at(date)
          }
        }
        year += rule.interval
      }
      return
    }
  }
}

/** Days into the week, given where the week starts. */
function offsetInWeek(day: number, weekStart: 0 | 1): number {
  return (day - weekStart + 7) % 7
}

/** BYMONTH / BYDAY filters for the simple (non-expanding) frequencies. */
function matchesFilters(date: LocalDate, rule: Rule): boolean {
  const p = dt.parse(date)
  if (rule.byMonth?.length && !rule.byMonth.includes(p.m)) return false
  if (rule.freq === 'DAILY' && rule.byDay?.length) {
    const wd = dt.weekday(date)
    if (!rule.byDay.some((b) => b.day === wd)) return false
  }
  return true
}

/**
 * The matching days inside one month, ascending, after BYSETPOS.
 * `fallbackDay` is dtstart's day-of-month, used when the rule says nothing.
 */
function datesInMonth(y: number, m: number, rule: Rule, fallbackDay: number): LocalDate[] {
  if (rule.byMonth?.length && !rule.byMonth.includes(m)) return []
  const last = dt.daysInMonth(y, m)
  const mk = (d: number): LocalDate => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

  let days: number[] = []

  if (rule.byDay?.length) {
    const ordered = rule.byDay.some((b) => b.ord != null)
    if (ordered) {
      for (const b of rule.byDay) {
        const all = weekdayDates(y, m, b.day)
        if (b.ord == null) {
          days.push(...all)
        } else {
          const idx = b.ord > 0 ? b.ord - 1 : all.length + b.ord
          if (idx >= 0 && idx < all.length) days.push(all[idx])
        }
      }
    } else {
      for (const b of rule.byDay) days.push(...weekdayDates(y, m, b.day))
    }
    // Intersect with BYMONTHDAY when both are present, per RFC 5545.
    if (rule.byMonthDay?.length) {
      const wanted = new Set(rule.byMonthDay.map((d) => (d > 0 ? d : last + d + 1)))
      days = days.filter((d) => wanted.has(d))
    }
  } else if (rule.byMonthDay?.length) {
    for (const d of rule.byMonthDay) {
      const day = d > 0 ? d : last + d + 1
      if (day >= 1 && day <= last) days.push(day)
    }
  } else {
    // No BY* parts: keep dtstart's day, and skip months that are too short
    // (RFC 5545 says skip, not clamp — Feb has no 31st).
    if (fallbackDay <= last) days.push(fallbackDay)
  }

  days = [...new Set(days)].sort((a, b) => a - b)

  if (rule.bySetPos?.length) {
    const picked: number[] = []
    for (const pos of rule.bySetPos) {
      const idx = pos > 0 ? pos - 1 : days.length + pos
      if (idx >= 0 && idx < days.length) picked.push(days[idx])
    }
    days = [...new Set(picked)].sort((a, b) => a - b)
  }

  return days.map(mk)
}

/** Every day-of-month in (y, m) that falls on `weekday`, ascending. */
function weekdayDates(y: number, m: number, weekday: number): number[] {
  const last = dt.daysInMonth(y, m)
  const firstWd = new Date(y, m - 1, 1).getDay()
  const first = 1 + ((weekday - firstWd + 7) % 7)
  const out: number[] = []
  for (let d = first; d <= last; d += 7) out.push(d)
  return out
}

/* --------------------------- human-readable rules -------------------------- */

const DAY_NAMES_RU = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const PLURAL_RU: Record<Freq, [string, string, string]> = {
  DAILY: ['день', 'дня', 'дней'],
  WEEKLY: ['неделю', 'недели', 'недель'],
  MONTHLY: ['месяц', 'месяца', 'месяцев'],
  YEARLY: ['год', 'года', 'лет'],
}

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1]
  return forms[2]
}

/** A short Russian summary for the editor, e.g. "Каждые 2 недели: пн, ср". */
export function describeRule(rrule: string | undefined, dtstart?: Local): string {
  const rule = parseRule(rrule ?? '')
  if (!rule) return 'Не повторяется'

  const n = rule.interval
  const base =
    n === 1
      ? { DAILY: 'Каждый день', WEEKLY: 'Каждую неделю', MONTHLY: 'Каждый месяц', YEARLY: 'Каждый год' }[rule.freq]
      : `Каждые ${n} ${plural(n, PLURAL_RU[rule.freq])}`

  const bits: string[] = [base]

  if (rule.freq === 'WEEKLY' && rule.byDay?.length) {
    const days = [...rule.byDay]
      .sort((a, b) => offsetInWeek(a.day, rule.weekStart) - offsetInWeek(b.day, rule.weekStart))
      .map((b) => DAY_NAMES_RU[b.day])
    bits.push(`: ${days.join(', ')}`)
  }

  if ((rule.freq === 'MONTHLY' || rule.freq === 'YEARLY') && rule.byDay?.length) {
    const b = rule.byDay[0]
    const ord = b.ord ?? rule.bySetPos?.[0]
    const ordName =
      ord === -1 ? 'в последний' : ord === 1 ? 'в первый' : ord === 2 ? 'во второй' : ord === 3 ? 'в третий' : ord === 4 ? 'в четвёртый' : null
    bits.push(ordName ? ` ${ordName} ${DAY_NAMES_RU[b.day]}` : `: ${DAY_NAMES_RU[b.day]}`)
  } else if (rule.freq === 'MONTHLY' && rule.byMonthDay?.length) {
    bits.push(`, ${rule.byMonthDay.map((d) => (d < 0 ? 'последнее число' : `${d}-е`)).join(', ')}`)
  } else if (rule.freq === 'MONTHLY' && dtstart) {
    bits.push(`, ${dt.parse(dtstart).d}-е число`)
  }

  if (rule.count) bits.push(` · ${rule.count} ${plural(rule.count, ['раз', 'раза', 'раз'])}`)
  else if (rule.until) bits.push(` · до ${dt.formatDateShort(rule.until)}`)

  return bits.join('')
}

/** Ready-made rules for the quick-pick row in the editor. */
export function presetRules(dtstart: Local): { label: string; rrule?: string }[] {
  const wd = dt.weekday(dtstart)
  const day = DAY_CODES[wd]
  const monthDay = dt.parse(dtstart).d
  return [
    { label: 'Не повторяется', rrule: undefined },
    { label: 'Каждый день', rrule: 'FREQ=DAILY' },
    { label: 'По будням', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
    { label: 'Каждую неделю', rrule: `FREQ=WEEKLY;BYDAY=${day}` },
    { label: 'Каждые 2 недели', rrule: `FREQ=WEEKLY;INTERVAL=2;BYDAY=${day}` },
    { label: 'Каждый месяц', rrule: `FREQ=MONTHLY;BYMONTHDAY=${monthDay}` },
    { label: 'Каждый год', rrule: 'FREQ=YEARLY' },
  ]
}
