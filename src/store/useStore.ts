/**
 * The one store.
 *
 * Two rules worth knowing before editing this file:
 *
 * 1. **Writes are optimistic.** The array in memory changes first, the
 *    database after. A failed write restores the previous array and surfaces
 *    an error, so the UI never waits on IndexedDB to feel responsive.
 * 2. **Events are loaded by window, not all at once**, and the window is
 *    padded (see `loadRange`). Paging a month lands inside what is already
 *    loaded, so the grid does not flash.
 */

import { create } from 'zustand'
import * as db from '../lib/db.ts'
import * as dt from '../lib/datetime.ts'
import { DEFAULT_SETTINGS, seedIfEmpty } from '../lib/seed.ts'
import { covers, loadRange, stepCursor, visibleRange } from '../lib/view.ts'
import { deleteFromSeries, editSeries, type EventChanges, type SeriesScope } from '../lib/series.ts'
import { parseIcs } from '../lib/ics.ts'
import { COLOR_KEYS } from '../lib/colors.ts'
import {
  DEFAULT_REFRESH_MINUTES,
  FeedError,
  describeOutcome,
  diffFeed,
  fetchFeedDiff,
  isDue,
  normaliseUrl,
} from '../lib/feed.ts'
import { platform } from '../platform.ts'

export interface ImportSummary {
  added: number
  updated: number
  skipped: number
}
import type { Range } from '../lib/occurrences.ts'
import type { CalEvent, Calendar, Occurrence, Settings, Task, ViewMode } from '../lib/types.ts'
import type { LocalDate } from '../lib/datetime.ts'

/**
 * Enough of an occurrence to act on it. A full `Occurrence` satisfies this,
 * and so does the editor, which has an event plus the instance it was opened
 * on but no laid-out block.
 */
export interface OccurrenceRef {
  eventId: string
  start: string
  title?: string
  readOnly?: boolean
}

export interface PendingScope {
  mode: 'edit' | 'delete'
  event: CalEvent
  occurrenceStart: string
  changes: EventChanges
  /** Shown in the dialog so the user knows what they are about to change. */
  title: string
}

export interface EditorTarget {
  /** The event being edited, or a draft that has no id yet. */
  event: CalEvent
  /** True when this is a brand-new event, so cancel means discard. */
  isNew: boolean
  /** The occurrence clicked, when the event is a recurring series. */
  occurrenceStart?: string
}

interface State {
  ready: boolean
  error: string | null

  calendars: Calendar[]
  events: CalEvent[]
  tasks: Task[]
  settings: Settings

  view: ViewMode
  cursor: LocalDate
  /** The window currently held in `events`, or null before the first load. */
  loaded: Range | null
  loading: boolean

  selectedKey: string | null
  editor: EditorTarget | null

  init(): Promise<void>
  setView(view: ViewMode): Promise<void>
  setCursor(cursor: LocalDate): Promise<void>
  goToday(): Promise<void>
  step(direction: -1 | 1): Promise<void>

  setCalendarVisible(id: string, visible: boolean): Promise<void>
  saveCalendar(calendar: Calendar): Promise<void>

  saveEvent(event: CalEvent): Promise<CalEvent | null>
  deleteEvent(id: string): Promise<void>

  saveTask(task: Task): Promise<Task | null>
  toggleTaskDone(id: string): Promise<void>
  deleteTask(id: string): Promise<void>

  updateSettings(patch: Partial<Settings>): Promise<void>

  /** A change waiting on the user to pick a scope. */
  pendingScope: PendingScope | null
  /**
   * Change the times (or fields) behind an occurrence. A single event is
   * written straight away; a recurring one first asks what to apply it to.
   */
  applyOccurrenceChange(occ: OccurrenceRef, changes: EventChanges): Promise<void>
  deleteOccurrence(occ: OccurrenceRef): Promise<void>
  resolveScope(scope: SeriesScope): Promise<void>
  cancelScope(): void

  /** Merge an .ics file into a calendar. Nothing is removed. */
  importIcs(text: string, calendarId: string): Promise<ImportSummary>
  /** Subscribe to a feed and read it once. */
  addFeed(url: string, name?: string): Promise<string | null>
  /** Re-read one feed. */
  refreshFeed(calendarId: string): Promise<string | null>
  /** Re-read every feed that is due. */
  refreshDueFeeds(): Promise<void>
  removeCalendar(id: string): Promise<void>
  /** Replace or merge the whole database from a backup. */
  restoreBackup(dump: db.Dump, mode: db.ImportMode): Promise<string | null>

  select(key: string | null): void
  openEditor(target: EditorTarget | null): void
  /** Open the editor on the event behind an occurrence. */
  openOccurrence(occ: Occurrence): void
  /** Open the editor on a blank event in the given slot. */
  startNewEvent(start: string, end: string, allDay: boolean): void
  dismissError(): void
}

/** Guards against an older load finishing after a newer one. */
let loadToken = 0

/**
 * `init` must run once per process even if called again. React StrictMode
 * mounts effects twice in development, and two concurrent inits raced each
 * other through the seed check.
 */
let initPromise: Promise<void> | null = null

/** Test seam: forget that init already ran, so it can be exercised again. */
export function resetInitForTests(): void {
  initPromise = null
}

export const useStore = create<State>()((set, get) => ({
  ready: false,
  error: null,

  calendars: [],
  events: [],
  tasks: [],
  settings: DEFAULT_SETTINGS,

  view: 'month',
  cursor: dt.today(),
  loaded: null,
  loading: false,

  selectedKey: null,
  editor: null,

  init() {
    initPromise ??= runInit(set, get)
    return initPromise
  },

  async setView(view) {
    set({ view })
    await loadWindow(view, get().cursor, set, get)
  },

  async setCursor(cursor) {
    set({ cursor: dt.dateOf(cursor) })
    await loadWindow(get().view, get().cursor, set, get)
  },

  async goToday() {
    await get().setCursor(dt.today())
  },

  async step(direction) {
    const { view, cursor } = get()
    await get().setCursor(stepCursor(view, cursor, direction))
  },

  async setCalendarVisible(id, visible) {
    const target = get().calendars.find((c) => c.id === id)
    if (!target) return
    await get().saveCalendar({ ...target, visible })
  },

  async saveCalendar(calendar) {
    const record = withId(calendar)
    const previous = get().calendars
    const optimistic = upsert(previous, record).sort((a, b) => a.order - b.order)
    set({ calendars: optimistic })
    try {
      const saved = await db.calendars.put(record)
      set({ calendars: upsert(get().calendars, saved).sort((a, b) => a.order - b.order) })
    } catch (e) {
      set({ calendars: previous, error: describe(e) })
    }
  },

  async saveEvent(event) {
    const record = withId(event)
    const previous = get().events
    set({ events: upsert(previous, record) })
    try {
      const saved = await db.events.put(record)
      set({ events: upsert(get().events, saved) })
      return saved
    } catch (e) {
      set({ events: previous, error: describe(e) })
      return null
    }
  },

  async deleteEvent(id) {
    const previous = get().events
    set({ events: previous.filter((e) => e.id !== id), selectedKey: null, editor: null })
    try {
      await db.events.remove(id)
    } catch (e) {
      set({ events: previous, error: describe(e) })
    }
  },

  async saveTask(task) {
    const record = withId(task)
    const previous = get().tasks
    set({ tasks: upsert(previous, record) })
    try {
      const saved = await db.tasks.put(record)
      set({ tasks: upsert(get().tasks, saved) })
      return saved
    } catch (e) {
      set({ tasks: previous, error: describe(e) })
      return null
    }
  },

  async toggleTaskDone(id) {
    const task = get().tasks.find((t) => t.id === id)
    if (!task) return
    const done = !task.done
    await get().saveTask({ ...task, done, completedAt: done ? Date.now() : null })
  },

  async deleteTask(id) {
    const previous = get().tasks
    set({ tasks: previous.filter((t) => t.id !== id) })
    try {
      await db.tasks.remove(id)
    } catch (e) {
      set({ tasks: previous, error: describe(e) })
    }
  },

  async updateSettings(patch) {
    const previous = get().settings
    const next = { ...previous, ...patch }
    set({ settings: next })
    if (patch.theme) applyTheme(patch.theme)
    if (patch.locale) dt.setLocale(patch.locale)
    try {
      await db.putSettings(next)
    } catch (e) {
      set({ settings: previous, error: describe(e) })
    }
    // The week start changes which days the grid covers.
    if (patch.weekStart !== undefined) await loadWindow(get().view, get().cursor, set, get)
  },

  async importIcs(text, calendarId) {
    const parsed = parseIcs(text)
    // Matched across every calendar, not just the destination: re-importing a
    // file whose events already live elsewhere must update them, not clone
    // them into the target.
    const existing = await db.events.list({ includeDeleted: true })
    // A file import adds to the calendar; it does not make the file the truth,
    // so nothing missing from it is removed.
    const diff = diffFeed(existing, parsed.events, calendarId, {
      readOnly: false,
      removeMissing: false,
      scope: 'all',
    })
    for (const record of diff.writes) await get().saveEvent(record)
    await reloadWindow(set, get)
    return { added: diff.added, updated: diff.updated, skipped: parsed.skipped }
  },

  async addFeed(url, name) {
    const clean = normaliseUrl(url)
    if (!clean) {
      set({ error: 'Нужна ссылка на календарь' })
      return null
    }
    if (get().calendars.some((c) => c.url === clean && c.deletedAt == null)) {
      set({ error: 'Такая подписка уже есть' })
      return null
    }

    const order = get().calendars.reduce((max, c) => Math.max(max, c.order), -1) + 1
    const calendar: Calendar = {
      id: '',
      uid: '',
      updatedAt: 0,
      name: name?.trim() || 'Подписка',
      color: COLOR_KEYS[order % COLOR_KEYS.length],
      visible: true,
      readOnly: true,
      kind: 'ics-feed',
      url: clean,
      refreshMinutes: DEFAULT_REFRESH_MINUTES,
      order,
    }
    await get().saveCalendar(calendar)
    const created = get().calendars.find((c) => c.url === clean)
    if (!created) return null
    return get().refreshFeed(created.id)
  },

  async refreshFeed(calendarId) {
    const calendar = get().calendars.find((c) => c.id === calendarId)
    if (!calendar?.url) return null

    set({ loading: true })
    try {
      const existing = await db.events.byCalendar(calendarId, { includeDeleted: true })
      const outcome = await fetchFeedDiff(calendar, existing, platform().fetcher)

      for (const record of outcome.writes) await db.events.put(record)
      for (const id of outcome.deletes) await db.events.remove(id)

      await get().saveCalendar({
        ...calendar,
        // Keep the publisher's own name if the user has not renamed it.
        name: calendar.name === 'Подписка' && outcome.calendarName ? outcome.calendarName : calendar.name,
        lastSyncAt: Date.now(),
        lastSyncError: null,
      })
      await reloadWindow(set, get)
      set({ loading: false })
      return describeOutcome(outcome)
    } catch (e) {
      const message = e instanceof FeedError ? e.message : describe(e)
      // Past events stay: a failed refresh must not empty the calendar.
      await get().saveCalendar({ ...calendar, lastSyncError: message })
      set({ loading: false, error: message })
      return null
    }
  },

  async refreshDueFeeds() {
    for (const calendar of get().calendars) {
      if (calendar.kind !== 'ics-feed' || calendar.deletedAt != null) continue
      if (!isDue(calendar)) continue
      await get().refreshFeed(calendar.id)
    }
  },

  async removeCalendar(id) {
    const previous = get().calendars
    set({ calendars: previous.filter((c) => c.id !== id) })
    try {
      for (const event of await db.events.byCalendar(id)) await db.events.remove(event.id)
      await db.calendars.remove(id)
      await reloadWindow(set, get)
    } catch (e) {
      set({ calendars: previous, error: describe(e) })
    }
  },

  async restoreBackup(dump, mode) {
    try {
      const result = await db.importDump(dump, mode)
      resetInitForTests()
      set({ loaded: null, ready: false })
      await get().init()
      const bits = [`календарей ${result.calendars}`, `событий ${result.events}`, `задач ${result.tasks}`]
      if (result.skipped) bits.push(`пропущено ${result.skipped}`)
      return bits.join(', ')
    } catch (e) {
      set({ error: describe(e) })
      return null
    }
  },

  select(key) {
    set({ selectedKey: key })
  },

  openEditor(editor) {
    set({ editor })
  },

  pendingScope: null,

  async applyOccurrenceChange(occ, changes) {
    const event = get().events.find((e) => e.id === occ.eventId)
    if (!event) return
    if (occ.readOnly) {
      set({ error: 'Событие из подписки можно только читать' })
      return
    }
    if (!event.rrule) {
      await get().saveEvent({ ...event, ...changes })
      return
    }
    set({
      pendingScope: { mode: 'edit', event, occurrenceStart: occ.start, changes, title: occ.title ?? '' },
    })
  },

  async deleteOccurrence(occ) {
    const event = get().events.find((e) => e.id === occ.eventId)
    if (!event) return
    if (!event.rrule) {
      await get().deleteEvent(event.id)
      return
    }
    set({
      pendingScope: { mode: 'delete', event, occurrenceStart: occ.start, changes: {}, title: occ.title ?? '' },
    })
  },

  async resolveScope(scope) {
    const pending = get().pendingScope
    if (!pending) return
    set({ pendingScope: null })

    const { writes, deletes } =
      pending.mode === 'delete'
        ? deleteFromSeries(pending.event, pending.occurrenceStart, scope)
        : editSeries(pending.event, pending.occurrenceStart, pending.changes, scope)

    // Writes go through saveEvent one at a time so each gets its id and the
    // optimistic list stays consistent even if a later one fails.
    for (const record of writes) await get().saveEvent(record)
    for (const id of deletes) await get().deleteEvent(id)
    set({ editor: null })
  },

  cancelScope() {
    set({ pendingScope: null })
  },

  openOccurrence(occ) {
    const event = get().events.find((e) => e.id === occ.eventId)
    if (!event) return
    set({
      selectedKey: occ.key,
      editor: {
        // Show the instance the user clicked, not the series' first one: a
        // weekly meeting opened on 30 November should read "30 November".
        event: occ.recurring ? { ...event, start: occ.start, end: occ.end } : event,
        isNew: false,
        occurrenceStart: occ.recurring ? occ.start : undefined,
      },
    })
  },

  startNewEvent(start, end, allDay) {
    const { calendars, settings } = get()
    const calendarId = calendars.find((c) => !c.readOnly && c.visible)?.id ?? calendars[0]?.id
    if (!calendarId) {
      set({ error: 'Сначала нужен календарь, в который можно писать' })
      return
    }
    set({
      selectedKey: null,
      editor: {
        event: draftEvent(calendarId, start, end, allDay, settings.defaultReminders),
        isNew: true,
      },
    })
  },

  dismissError() {
    set({ error: null })
  },
}))

/* -------------------------------- helpers -------------------------------- */

type Setter = (partial: Partial<State>) => void
type Getter = () => State

/** Open the database, seed it if new, load settings and the first window. */
async function runInit(set: Setter, get: Getter): Promise<void> {
  try {
    await seedIfEmpty()
    // Tombstones are swept in the background; a failure there must not stop
    // the app from opening, so it is deliberately not awaited with the rest.
    void db.purgeAll().catch((e) => console.warn('[db] purge failed', e))

    const [settings, calendars, tasks] = await Promise.all([
      db.getSettings(),
      db.calendars.list(),
      db.tasks.list(),
    ])
    // Merged over the defaults, not used as-is: a settings record written by
    // an older build has no key for a setting added since, and reading it as
    // `undefined` silently turns that feature off. This is the cheap
    // alternative to a schema migration for every new preference.
    const resolved = { ...DEFAULT_SETTINGS, ...(settings ?? {}) }
    dt.setLocale(resolved.locale)
    applyTheme(resolved.theme)

    set({
      settings: resolved,
      calendars: calendars.sort((a, b) => a.order - b.order),
      tasks,
      ready: true,
    })
    await loadWindow(get().view, get().cursor, set, get)

    // Feeds refresh in the background: a slow or unreachable subscription must
    // not hold up the calendar opening.
    void get()
      .refreshDueFeeds()
      .catch((e) => console.warn('[feed] refresh failed', e))
  } catch (e) {
    set({ ready: true, error: describe(e) })
  }
}

/**
 * Fetch the event window for a view, unless the one in memory already covers
 * it. The token check drops a stale response, which otherwise shows the wrong
 * month when two page clicks land in quick succession.
 */
async function loadWindow(view: ViewMode, cursor: LocalDate, set: Setter, get: Getter): Promise<void> {
  const visible = visibleRange(view, cursor, get().settings.weekStart)
  if (covers(get().loaded, visible)) return

  const want = loadRange(visible)
  const token = ++loadToken
  set({ loading: true })
  try {
    const events = await db.events.inRange(want.from, want.to)
    if (token !== loadToken) return
    set({ events, loaded: want, loading: false })
  } catch (e) {
    if (token !== loadToken) return
    set({ loading: false, error: describe(e) })
  }
}

/**
 * Give a brand-new record its id *before* the optimistic insert.
 *
 * Without this, a draft goes into the list with an empty id, the database
 * returns the same record with a generated one, and `upsert` — matching on id
 * — cannot find the optimistic copy, so it appends a second. One save then
 * produced two blocks in the grid until the next reload.
 */
function withId<T extends { id: string }>(record: T): T {
  return record.id ? record : { ...record, id: db.newId() }
}

/**
 * Force a re-read of the visible window.
 *
 * Needed after a bulk write (an import, a feed refresh) because those go
 * straight to the database rather than through `saveEvent`, so the in-memory
 * list knows nothing about them. Clearing `loaded` is what makes `loadWindow`
 * actually fetch instead of deciding it already has the range.
 */
async function reloadWindow(set: Setter, get: Getter): Promise<void> {
  set({ loaded: null })
  await loadWindow(get().view, get().cursor, set, get)
}

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const index = list.findIndex((x) => x.id === item.id)
  if (index === -1) return [...list, item]
  const copy = list.slice()
  copy[index] = item
  return copy
}

export function applyTheme(theme: Settings['theme']): void {
  if (typeof document === 'undefined') return
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

function describe(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

/** A blank event positioned where the user clicked. */
export function draftEvent(
  calendarId: string,
  start: string,
  end: string,
  allDay: boolean,
  reminders: Settings['defaultReminders'] = [],
): CalEvent {
  return {
    id: '',
    uid: '',
    updatedAt: 0,
    calendarId,
    title: '',
    start,
    end,
    allDay,
    reminders: [...reminders],
  }
}
