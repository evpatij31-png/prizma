/**
 * Reminders: work out what should fire and when, then fire it once.
 *
 * Three decisions shape this file:
 *
 * 1. **One timer, not one per reminder.** A daily series over a year is ~365
 *    reminders; scheduling a timeout for each would be absurd. Only the next
 *    one is ever scheduled, and the list is recomputed after it fires.
 * 2. **Fired keys are remembered in memory, not in the database.** They are
 *    session state; persisting them would grow without bound and mean nothing
 *    after a reload.
 * 3. **A missed reminder is shown only if it was missed recently.** Waking a
 *    laptop at 18:00 should not replay every alert since 09:00.
 */

import * as dt from './datetime.ts'
import type { Local } from './datetime.ts'
import type { Occurrence, Task } from './types.ts'

/** How late a reminder may be and still be worth showing. */
export const GRACE_MINUTES = 5

/** How far ahead reminders are collected in one pass. */
export const HORIZON_HOURS = 24

export interface ScheduledReminder {
  /** `${sourceId}:${at}` — stable, so the same alert is never shown twice. */
  key: string
  sourceId: string
  kind: 'event' | 'task'
  /** When to fire. */
  at: Local
  title: string
  body: string
}

export interface NotificationSink {
  show(reminder: ScheduledReminder): void
}

/* ------------------------------- collecting ------------------------------- */

export interface CollectOptions {
  from: Local
  to: Local
}

/**
 * Everything that should fire inside the window.
 *
 * Occurrences are expected to be pre-filtered to visible calendars — a hidden
 * calendar must not nag, and that rule lives in `queryOccurrences`.
 */
export function collectReminders(
  occurrences: Occurrence[],
  tasks: Task[],
  { from, to }: CollectOptions,
): ScheduledReminder[] {
  const out: ScheduledReminder[] = []

  for (const occ of occurrences) {
    for (const reminder of occ.reminders ?? []) {
      const at = minus(occ.start, reminder.minutesBefore)
      if (at < from || at >= to) continue
      out.push({
        key: `${occ.eventId}:${occ.start}:${reminder.minutesBefore}`,
        sourceId: occ.eventId,
        kind: 'event',
        at,
        title: occ.title || 'Без названия',
        body: eventBody(occ, reminder.minutesBefore),
      })
    }
  }

  for (const task of tasks) {
    if (task.deletedAt != null || task.done || !task.due) continue
    for (const reminder of task.reminders ?? []) {
      const at = minus(task.due, reminder.minutesBefore)
      if (at < from || at >= to) continue
      out.push({
        key: `${task.id}:${task.due}:${reminder.minutesBefore}`,
        sourceId: task.id,
        kind: 'task',
        at,
        title: task.title || 'Задача',
        body: taskBody(task.due, reminder.minutesBefore),
      })
    }
  }

  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.key.localeCompare(b.key)))
}

/** `start` minus `minutes`, as a wall-clock stamp. */
function minus(start: Local, minutes: number): Local {
  // A date-only deadline means the start of that day.
  const base = dt.hasTime(start) ? start : `${dt.dateOf(start)}T00:00`
  return dt.addMinutes(base, -Math.max(0, minutes))
}

function eventBody(occ: Occurrence, minutesBefore: number): string {
  const when = occ.allDay ? 'Весь день' : `В ${dt.formatTime(occ.start)}`
  const lead = minutesBefore > 0 ? `через ${dt.formatDuration(minutesBefore)}` : 'сейчас'
  const where = occ.location ? ` · ${occ.location}` : ''
  return `${when} (${lead})${where}`
}

function taskBody(due: Local, minutesBefore: number): string {
  const when = dt.hasTime(due) ? `Срок в ${dt.formatTime(due)}` : `Срок ${dt.formatDateShort(due)}`
  return minutesBefore > 0 ? `${when} · через ${dt.formatDuration(minutesBefore)}` : when
}

/* ------------------------------- partition -------------------------------- */

export interface Partitioned {
  /** Due now, or recently enough to still matter. */
  due: ScheduledReminder[]
  /** Missed by more than the grace period: dropped without showing. */
  stale: ScheduledReminder[]
  /** The soonest future one, which is what gets the single timer. */
  next: ScheduledReminder | null
}

/**
 * Split a list against the clock. `fired` is the set of keys already shown in
 * this session; without it, a recompute on tab focus would show the same
 * alert again.
 */
export function partitionDue(
  reminders: ScheduledReminder[],
  now: Local,
  fired: ReadonlySet<string> = new Set(),
  graceMinutes = GRACE_MINUTES,
): Partitioned {
  const cutoff = dt.addMinutes(now, -graceMinutes)
  const due: ScheduledReminder[] = []
  const stale: ScheduledReminder[] = []
  let next: ScheduledReminder | null = null

  for (const reminder of reminders) {
    if (fired.has(reminder.key)) continue
    if (reminder.at > now) {
      if (!next || reminder.at < next.at) next = reminder
      continue
    }
    if (reminder.at >= cutoff) due.push(reminder)
    else stale.push(reminder)
  }

  return { due, stale, next }
}

/** Milliseconds until a reminder, floored at zero. */
export function delayUntil(at: Local, now: Local): number {
  return Math.max(0, dt.toDate(at).getTime() - dt.toDate(now).getTime())
}

/* ------------------------------- scheduler -------------------------------- */

export interface SchedulerDeps {
  sink: NotificationSink
  /** Injectable for tests. */
  now?(): Local
  setTimer?(fn: () => void, ms: number): number
  clearTimer?(id: number): void
}

/**
 * Holds exactly one timer and the set of keys already shown.
 *
 * `update` is called whenever the data or the clock might have changed: at
 * startup, after any edit, when the tab becomes visible again, and on a slow
 * heartbeat. It is idempotent.
 */
export class ReminderScheduler {
  private readonly sink: NotificationSink
  private readonly nowFn: () => Local
  private readonly setTimer: (fn: () => void, ms: number) => number
  private readonly clearTimer: (id: number) => void

  private readonly fired = new Set<string>()
  private timer: number | null = null
  private latest: ScheduledReminder[] = []

  constructor({ sink, now, setTimer, clearTimer }: SchedulerDeps) {
    this.sink = sink
    this.nowFn = now ?? dt.now
    this.setTimer = setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number)
    this.clearTimer = clearTimer ?? ((id) => clearTimeout(id))
  }

  /** Replace the schedule. Fires anything already due, then arms the timer. */
  update(reminders: ScheduledReminder[]): void {
    this.latest = reminders
    this.run()
  }

  /** Number of alerts shown so far; for tests and diagnostics. */
  get firedCount(): number {
    return this.fired.size
  }

  stop(): void {
    if (this.timer != null) this.clearTimer(this.timer)
    this.timer = null
  }

  private run(): void {
    this.stop()
    const now = this.nowFn()
    const { due, stale, next } = partitionDue(this.latest, now, this.fired)

    for (const reminder of due) {
      this.fired.add(reminder.key)
      this.sink.show(reminder)
    }
    // Marked as fired without showing, so a later pass does not reconsider them.
    for (const reminder of stale) this.fired.add(reminder.key)

    if (next) {
      this.timer = this.setTimer(() => this.run(), delayUntil(next.at, now))
    }
  }
}

/* --------------------------------- sinks ---------------------------------- */

/** Browser notifications. Replaced wholesale by the mobile wrapper. */
export const webSink: NotificationSink = {
  show(reminder) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    new Notification(reminder.title, {
      body: reminder.body,
      tag: reminder.key,
      icon: './icons/icon-192.png',
    })
  },
}

/** Collects instead of showing; used by tests and by the in-app banner. */
export function createMemorySink(): NotificationSink & { shown: ScheduledReminder[] } {
  const shown: ScheduledReminder[] = []
  return { shown, show: (r) => void shown.push(r) }
}

/**
 * Ask for permission. Must be called from a user gesture — browsers ignore
 * (or permanently deny) a request made on page load.
 */
export async function requestPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  return (await Notification.requestPermission()) === 'granted'
}

export function permissionState(): 'granted' | 'denied' | 'default' | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}
