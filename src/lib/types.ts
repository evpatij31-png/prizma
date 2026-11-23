import type { Local, LocalDate, LocalDateTime } from './datetime.ts'

/**
 * Every stored record carries sync metadata from day one. The app is
 * offline-first today, but `uid` / `updatedAt` / `deletedAt` / `etag` are
 * exactly what a CalDAV or cloud sync needs later, so adding one does not
 * mean a migration: tombstones instead of hard deletes, a stable iCalendar
 * UID per item, and a last-write-wins clock.
 */
export interface Syncable {
  id: string
  /** iCalendar UID — stable across devices and servers. */
  uid: string
  /** Epoch ms of the last local change; the merge clock. */
  updatedAt: number
  /** Tombstone. Non-null means deleted but still syncable. */
  deletedAt?: number | null
  /** Server validator, when the record came from or went to a remote. */
  etag?: string
  /** Which source owns this record. */
  source?: string
}

export type CalendarKind = 'local' | 'ics-feed'

export interface Calendar extends Syncable {
  name: string
  /** Key into the palette in `colors.ts`. */
  color: ColorKey
  visible: boolean
  readOnly: boolean
  kind: CalendarKind
  /** For `ics-feed`: the subscription URL. */
  url?: string
  /** How often to refetch a feed, in minutes. */
  refreshMinutes?: number
  lastSyncAt?: number
  lastSyncError?: string | null
  /** Sort order in the sidebar. */
  order: number
}

export type ColorKey =
  | 'violet'
  | 'fuchsia'
  | 'rose'
  | 'amber'
  | 'lime'
  | 'emerald'
  | 'cyan'
  | 'sky'
  | 'indigo'
  | 'slate'

/** Minutes before the start; 0 means "at the time of the event". */
export interface Reminder {
  minutesBefore: number
}

export interface CalEvent extends Syncable {
  calendarId: string
  title: string
  description?: string
  location?: string
  /** Wall-clock. "YYYY-MM-DD" when `allDay`, else "YYYY-MM-DDTHH:mm". */
  start: Local
  /** Exclusive end. For all-day events this is the day *after* the last day. */
  end: Local
  allDay: boolean
  /** RFC 5545 RRULE body, e.g. "FREQ=WEEKLY;BYDAY=MO,WE". */
  rrule?: string
  /** Occurrence starts removed from the series. */
  exdates?: Local[]
  /** Set on a detached override: the id of the series it belongs to. */
  recurringEventId?: string
  /** For an override: the original occurrence start it replaces. */
  originalStart?: Local
  reminders: Reminder[]
  /** Free-form labels, handy for filtering later. */
  tags?: string[]
  /**
   * Set on an individual event that must not be edited, independently of its
   * calendar. An ICS feed normally marks the whole calendar read-only, but a
   * single imported event can be pinned this way too.
   */
  readOnly?: boolean
}

export type Priority = 0 | 1 | 2 | 3 // none | low | medium | high

export interface Task extends Syncable {
  calendarId: string
  title: string
  notes?: string
  /** Optional deadline; date-only tasks show in the all-day row. */
  due?: Local
  done: boolean
  completedAt?: number | null
  priority: Priority
  reminders: Reminder[]
  order: number
}

/* ---------------------------- derived view types --------------------------- */

/**
 * One concrete appearance of an event on the calendar. A recurring event
 * produces many of these; they are computed, never stored.
 */
export interface Occurrence {
  /** `${eventId}:${start}` — stable key for React and for EXDATE edits. */
  key: string
  eventId: string
  calendarId: string
  title: string
  location?: string
  description?: string
  start: Local
  end: Local
  allDay: boolean
  color: ColorKey
  /** True when this came from an RRULE rather than a single event. */
  recurring: boolean
  /** The untouched series start, needed to edit or except this instance. */
  seriesStart?: Local
  readOnly: boolean
  reminders: Reminder[]
}

/** A positioned occurrence inside a day column (week/day views). */
export interface LaidOutOccurrence {
  occ: Occurrence
  /** Fractions of the day column, 0..1. */
  top: number
  height: number
  /** Horizontal packing for overlapping events. */
  left: number
  width: number
  /** Stacking order so later-starting events sit on top. */
  z: number
}

export type ViewMode = 'month' | 'week' | 'day' | 'agenda'

export interface Settings {
  weekStart: 0 | 1
  /** Hour the day/week grid scrolls to on open. */
  dayStartHour: number
  dayEndHour: number
  locale: string
  theme: 'dark' | 'light' | 'system'
  /** Minutes; the drag/resize snap granularity. */
  snapMinutes: number
  defaultEventMinutes: number
  defaultReminders: Reminder[]
  showWeekNumbers: boolean
  showCompletedTasks: boolean
  /**
   * Dated tasks appear in the all-day row as well as the panel. On by
   * default: in the grid they are seen in the context of the day. Off for
   * anyone whose task list would otherwise bury the calendar.
   */
  showTasksInGrid: boolean
  /** Set once the user has granted the Notification permission. */
  notificationsEnabled: boolean
}

export interface NewEventDraft {
  calendarId?: string
  title?: string
  start: Local
  end: Local
  allDay: boolean
}

export type { Local, LocalDate, LocalDateTime }
