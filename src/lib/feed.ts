/**
 * Subscribing to someone else's calendar.
 *
 * This is what the "sync with Google / Apple / Outlook" requirement actually
 * buys in V1: all three publish a secret ICS URL, and reading it gives a
 * faithful, read-only copy. Writing back needs OAuth and a token server,
 * which is V2.
 *
 * Two things live here: a pure diff (what a refresh should change) and a
 * fetcher seam. The seam exists because the browser *cannot* read Google's or
 * iCloud's feed directly — no CORS header — while the desktop and mobile
 * wrappers can, since their request does not come from a web origin. Swapping
 * the fetcher is the whole of that platform difference.
 */

import { parseIcs, type ParsedEvent } from './ics.ts'
import type { CalEvent, Calendar } from './types.ts'

export type FeedErrorKind = 'blocked' | 'http' | 'empty' | 'invalid-url'

/**
 * Fields are declared and assigned explicitly rather than with TypeScript
 * parameter properties: Node's type stripping only erases types, and a
 * parameter property would have to *emit* assignments. Erasable syntax only
 * is a project-wide rule, not a quirk of this class.
 */
export class FeedError extends Error {
  kind: FeedErrorKind
  status?: number

  constructor(message: string, kind: FeedErrorKind, status?: number) {
    super(message)
    this.name = 'FeedError'
    this.kind = kind
    this.status = status
  }
}

export interface Fetcher {
  fetchText(url: string): Promise<string>
}

/** Default refresh interval for a new subscription. */
export const DEFAULT_REFRESH_MINUTES = 60

/**
 * Browser fetcher.
 *
 * A cross-origin failure surfaces as a bare `TypeError`, with no way to tell
 * "CORS refused" from "the network is down" — the browser deliberately hides
 * which. So the error says what the user can actually do about it instead of
 * guessing a cause.
 */
export const webFetcher: Fetcher = {
  async fetchText(url) {
    let parsed: URL
    try {
      parsed = new URL(normaliseUrl(url))
    } catch {
      throw new FeedError('Это не похоже на ссылку', 'invalid-url')
    }

    let response: Response
    try {
      response = await fetch(parsed.toString(), { redirect: 'follow' })
    } catch {
      throw new FeedError(
        'Браузер не смог прочитать эту ленту. Чаще всего это запрет сервера на чтение из ' +
          'браузера (CORS) — так делают Google и iCloud. Импортируйте файл .ics или откройте ' +
          'приложение на десктопе, где такого ограничения нет.',
        'blocked',
      )
    }

    if (!response.ok) {
      throw new FeedError(`Сервер ответил ${response.status}`, 'http', response.status)
    }

    const text = await response.text()
    if (!text.includes('BEGIN:VCALENDAR')) {
      throw new FeedError('По ссылке лежит не календарь', 'empty')
    }
    return text
  },
}

/** `webcal://` is an ICS feed over https; browsers do not know the scheme. */
export function normaliseUrl(url: string): string {
  return url.trim().replace(/^webcal:\/\//i, 'https://')
}

/* ---------------------------------- diff ---------------------------------- */

export interface FeedDiff {
  /** Records to write: new events and changed ones. */
  writes: CalEvent[]
  /** Ids to tombstone: events that vanished from the feed. */
  deletes: string[]
  added: number
  updated: number
  removed: number
  unchanged: number
}

const blank = { id: '', uid: '', updatedAt: 0 }

/**
 * What a refresh should change.
 *
 * Matching is by iCalendar UID, which is what makes a refresh idempotent:
 * re-reading an unchanged feed must leave the database exactly as it was, or
 * every hour would double the calendar.
 */
export interface DiffOptions {
  /** Feed events are read-only; events imported from a file are not. */
  readOnly?: boolean
  /**
   * Whether events missing from the input should be tombstoned. True for a
   * feed refresh (the feed is the truth); false for a file import, which adds
   * to a calendar rather than replacing it.
   */
  removeMissing?: boolean
  /**
   * Where to look for an existing event with the same UID.
   *
   * `'calendar'` for a feed refresh: the feed owns exactly one calendar and
   * must not touch anything else. `'all'` for a file import, because the same
   * event may already sit in a *different* calendar — matching only inside
   * the destination silently duplicates it, which is what re-importing your
   * own export used to do.
   */
  scope?: 'calendar' | 'all'
}

export function diffFeed(
  existing: CalEvent[],
  incoming: ParsedEvent[],
  calendarId: string,
  options: DiffOptions = {},
): FeedDiff {
  const readOnly = options.readOnly ?? true
  const removeMissing = options.removeMissing ?? true
  const scope = options.scope ?? 'calendar'
  const byUid = new Map<string, CalEvent>()
  for (const event of existing) {
    if (scope === 'calendar' && event.calendarId !== calendarId) continue
    // A tombstone still occupies its uid; the feed bringing it back should
    // revive that record rather than create a second one.
    byUid.set(event.uid, event)
  }

  const diff: FeedDiff = { writes: [], deletes: [], added: 0, updated: 0, removed: 0, unchanged: 0 }
  const seen = new Set<string>()

  for (const parsed of incoming) {
    seen.add(parsed.uid)
    const current = byUid.get(parsed.uid)

    const next: CalEvent = {
      ...(current ?? blank),
      // An event matched in another calendar stays where it is; only a new
      // one lands in the chosen destination.
      calendarId: current?.calendarId ?? calendarId,
      uid: parsed.uid,
      title: parsed.title,
      description: parsed.description,
      location: parsed.location,
      start: parsed.start,
      end: parsed.end,
      allDay: parsed.allDay,
      rrule: parsed.rrule,
      exdates: parsed.exdates,
      originalStart: parsed.originalStart,
      reminders: current?.reminders ?? [],
      readOnly: current ? (current.readOnly ?? readOnly) : readOnly,
      deletedAt: null,
    }

    if (!current) {
      diff.writes.push(next)
      diff.added++
    } else if (changed(current, next)) {
      diff.writes.push(next)
      diff.updated++
    } else {
      diff.unchanged++
    }
  }

  for (const [uid, event] of byUid) {
    if (!removeMissing) break
    if (seen.has(uid)) continue
    if (event.deletedAt != null) continue
    diff.deletes.push(event.id)
    diff.removed++
  }

  return diff
}

/** Compare only the fields a feed owns; `updatedAt` always differs. */
function changed(a: CalEvent, b: CalEvent): boolean {
  return (
    a.title !== b.title ||
    a.start !== b.start ||
    a.end !== b.end ||
    a.allDay !== b.allDay ||
    (a.description ?? '') !== (b.description ?? '') ||
    (a.location ?? '') !== (b.location ?? '') ||
    (a.rrule ?? '') !== (b.rrule ?? '') ||
    (a.exdates ?? []).join(',') !== (b.exdates ?? []).join(',') ||
    a.deletedAt != null
  )
}

/* --------------------------------- syncing -------------------------------- */

export interface FeedSyncOutcome extends FeedDiff {
  /** Events in the file that could not be read. */
  skipped: number
  calendarName?: string
}

/**
 * Fetch, parse and diff. Nothing is written here — the caller persists the
 * result, so this stays testable with a fake fetcher and no database.
 */
export async function fetchFeedDiff(
  calendar: Pick<Calendar, 'id' | 'url'>,
  existing: CalEvent[],
  fetcher: Fetcher = webFetcher,
): Promise<FeedSyncOutcome> {
  if (!calendar.url) throw new FeedError('У календаря нет ссылки', 'invalid-url')
  const text = await fetcher.fetchText(calendar.url)
  const parsed = parseIcs(text)
  return {
    ...diffFeed(existing, parsed.events, calendar.id, { readOnly: true, removeMissing: true }),
    skipped: parsed.skipped,
    calendarName: parsed.calendarName,
  }
}

/** Is this feed due a refresh? */
export function isDue(calendar: Pick<Calendar, 'lastSyncAt' | 'refreshMinutes'>, now = Date.now()): boolean {
  if (!calendar.lastSyncAt) return true
  const every = (calendar.refreshMinutes ?? DEFAULT_REFRESH_MINUTES) * 60_000
  return now - calendar.lastSyncAt >= every
}

/** A one-line summary of what a refresh did, for the UI. */
export function describeOutcome(outcome: FeedSyncOutcome): string {
  const bits: string[] = []
  if (outcome.added) bits.push(`добавлено ${outcome.added}`)
  if (outcome.updated) bits.push(`обновлено ${outcome.updated}`)
  if (outcome.removed) bits.push(`удалено ${outcome.removed}`)
  if (outcome.skipped) bits.push(`пропущено ${outcome.skipped}`)
  if (!bits.length) return 'Изменений нет'
  return bits.join(', ')
}
