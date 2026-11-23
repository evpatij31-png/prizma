/**
 * First-run data.
 *
 * The emptiness test is the raw record count, tombstones included — not a
 * "seeded" flag. A user who deletes every calendar leaves tombstones behind,
 * so the count stays above zero and we do not helpfully hand their calendars
 * back to them.
 */

import * as dt from './datetime.ts'
import { calendars, events, getSettings, putSettings, tasks } from './db.ts'
import type { CalEvent, Calendar, Settings, Task } from './types.ts'

export const DEFAULT_SETTINGS: Settings = {
  weekStart: 1,
  dayStartHour: 8,
  dayEndHour: 22,
  locale: 'ru-RU',
  theme: 'dark',
  snapMinutes: 15,
  defaultEventMinutes: 60,
  defaultReminders: [{ minutesBefore: 10 }],
  showWeekNumbers: false,
  showCompletedTasks: true,
  showTasksInGrid: true,
  notificationsEnabled: false,
}

/** Records are written through `put`, which fills in id, uid and updatedAt. */
const blank = { id: '', uid: '', updatedAt: 0 }

export interface SeedResult {
  seeded: boolean
  calendars: number
  events: number
  tasks: number
}

/**
 * In-flight guard. The emptiness check and the writes are separated by an
 * await, so two overlapping callers both saw an empty store and both seeded —
 * React StrictMode calls the effect twice and reproduced it every time. The
 * promise is shared rather than the check repeated, because IndexedDB gives us
 * no transaction spanning the whole operation.
 */
let seeding: Promise<SeedResult> | null = null

export function seedIfEmpty(withSampleData = true): Promise<SeedResult> {
  seeding ??= runSeed(withSampleData).finally(() => {
    seeding = null
  })
  return seeding
}

async function runSeed(withSampleData: boolean): Promise<SeedResult> {
  const existing = await calendars.count()
  if (existing > 0) {
    // Settings may still be missing if a previous run failed between writes.
    if (!(await getSettings())) await putSettings(DEFAULT_SETTINGS)
    return { seeded: false, calendars: 0, events: 0, tasks: 0 }
  }

  const personal: Calendar = {
    ...blank,
    name: 'Личное',
    color: 'violet',
    visible: true,
    readOnly: false,
    kind: 'local',
    order: 0,
  }
  const work: Calendar = {
    ...blank,
    name: 'Работа',
    color: 'cyan',
    visible: true,
    readOnly: false,
    kind: 'local',
    order: 1,
  }

  const savedPersonal = await calendars.put(personal)
  const savedWork = await calendars.put(work)
  await putSettings({ ...DEFAULT_SETTINGS, locale: detectLocale() })

  if (!withSampleData) {
    return { seeded: true, calendars: 2, events: 0, tasks: 0 }
  }

  const sampleEvents = sample(savedPersonal.id, savedWork.id)
  const sampleTasks = sampleTaskList(savedPersonal.id)
  await events.putMany(sampleEvents)
  await tasks.putMany(sampleTasks)

  return { seeded: true, calendars: 2, events: sampleEvents.length, tasks: sampleTasks.length }
}

function detectLocale(): string {
  if (typeof navigator !== 'undefined' && navigator.language) return navigator.language
  return DEFAULT_SETTINGS.locale
}

/**
 * Example events, positioned relative to today so they are always on screen.
 * Deliberately includes a recurring series, an all-day span and a pair that
 * overlap, because those are the three cases the views have to get right and
 * an empty calendar demonstrates none of them.
 */
function sample(personalId: string, workId: string): CalEvent[] {
  const today = dt.today()
  const monday = dt.startOfWeek(today, 1)
  const at = (dayOffset: number, time: string) => `${dt.dateOf(dt.addDays(monday, dayOffset))}T${time}`

  return [
    {
      ...blank,
      calendarId: workId,
      title: 'Планёрка',
      start: at(0, '10:00'),
      end: at(0, '10:30'),
      allDay: false,
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      reminders: [{ minutesBefore: 10 }],
      description: 'Повторяется каждую неделю — попробуйте изменить одно вхождение.',
    },
    {
      ...blank,
      calendarId: workId,
      title: 'Ревью дизайна',
      start: at(2, '14:00'),
      end: at(2, '15:30'),
      allDay: false,
      reminders: [{ minutesBefore: 15 }],
      location: 'Переговорная 3',
    },
    {
      ...blank,
      calendarId: workId,
      title: 'Созвон с подрядчиком',
      // Overlaps the review on purpose: two overlapping events must each stay
      // readable at half column width.
      start: at(2, '14:45'),
      end: at(2, '15:15'),
      allDay: false,
      reminders: [],
    },
    {
      ...blank,
      calendarId: personalId,
      title: 'Спортзал',
      start: at(1, '19:00'),
      end: at(1, '20:00'),
      allDay: false,
      rrule: 'FREQ=WEEKLY;BYDAY=TU,TH',
      reminders: [{ minutesBefore: 30 }],
    },
    {
      ...blank,
      calendarId: personalId,
      title: 'Поездка к родителям',
      // All-day end is exclusive: Sat + Sun means end is Monday.
      start: dt.dateOf(dt.addDays(monday, 5)),
      end: dt.dateOf(dt.addDays(monday, 7)),
      allDay: true,
      reminders: [],
    },
    {
      ...blank,
      calendarId: personalId,
      title: 'День рождения Ани',
      start: dt.dateOf(dt.addDays(today, 12)),
      end: dt.dateOf(dt.addDays(today, 13)),
      allDay: true,
      rrule: 'FREQ=YEARLY',
      reminders: [{ minutesBefore: 1440 }],
    },
  ]
}

function sampleTaskList(calendarId: string): Task[] {
  const today = dt.today()
  return [
    {
      ...blank,
      calendarId,
      title: 'Оплатить интернет',
      due: dt.dateOf(dt.addDays(today, 1)),
      done: false,
      priority: 2,
      reminders: [{ minutesBefore: 0 }],
      order: 1,
    },
    {
      ...blank,
      calendarId,
      title: 'Записаться к врачу',
      due: dt.dateOf(dt.addDays(today, 3)),
      done: false,
      priority: 3,
      reminders: [],
      order: 2,
    },
    {
      ...blank,
      calendarId,
      title: 'Разобрать фотографии',
      done: false,
      priority: 0,
      reminders: [],
      order: 3,
    },
  ]
}
