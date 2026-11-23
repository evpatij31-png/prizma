import { useEffect, useMemo, useRef, useState } from 'react'

import * as dt from '../lib/datetime.ts'
import { queryOccurrences } from '../lib/occurrences.ts'
import {
  HORIZON_HOURS,
  ReminderScheduler,
  collectReminders,
  type NotificationSink,
  type ScheduledReminder,
} from '../lib/reminders.ts'
import { platform } from '../platform.ts'
import { useStore } from '../store/useStore.ts'

/** How often the schedule is rebuilt even if nothing changed. */
const HEARTBEAT_MS = 15 * 60_000

/** How long an in-app banner stays up. */
const BANNER_MS = 20_000

/**
 * Runs the reminder scheduler and shows what fires.
 *
 * Alerts go to two places at once: a system notification when the user has
 * granted permission, and an in-app banner always. The banner is not a
 * fallback — it is what makes a reminder visible when the window is already
 * in front of you, where a system notification is easy to miss.
 */
export function ReminderHost() {
  const events = useStore((s) => s.events)
  const calendars = useStore((s) => s.calendars)
  const tasks = useStore((s) => s.tasks)
  const ready = useStore((s) => s.ready)

  const [banners, setBanners] = useState<ScheduledReminder[]>([])
  /** Bumped to force a rebuild on the heartbeat and on tab focus. */
  const [tick, setTick] = useState(0)

  const scheduler = useRef<ReminderScheduler | null>(null)

  if (!scheduler.current) {
    const sink: NotificationSink = {
      show(reminder) {
        platform().sink.show(reminder)
        setBanners((current) => [...current.filter((b) => b.key !== reminder.key), reminder])
        setTimeout(() => setBanners((current) => current.filter((b) => b.key !== reminder.key)), BANNER_MS)
      },
    }
    scheduler.current = new ReminderScheduler({ sink })
  }

  const reminders = useMemo(() => {
    if (!ready) return []
    const from = dt.now()
    const to = dt.addMinutes(from, HORIZON_HOURS * 60)
    // Hidden calendars are filtered inside queryOccurrences, so a hidden
    // calendar cannot nag.
    const occurrences = queryOccurrences(events, calendars, { from, to })
    return collectReminders(occurrences, tasks, { from: dt.addMinutes(from, -60), to })
    // `tick` is a deliberate dependency: it is how the heartbeat and a tab
    // regaining focus force the window to move forward.
  }, [events, calendars, tasks, ready, tick])

  useEffect(() => {
    scheduler.current?.update(reminders)
  }, [reminders])

  useEffect(() => {
    const beat = setInterval(() => setTick((t) => t + 1), HEARTBEAT_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') setTick((t) => t + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(beat)
      document.removeEventListener('visibilitychange', onVisible)
      scheduler.current?.stop()
    }
  }, [])

  if (!banners.length) return null

  return (
    <div className="pad-safe-b pointer-events-none fixed inset-x-3 top-16 z-50 mx-auto flex max-w-sm flex-col gap-2">
      {banners.map((reminder) => (
        <div
          key={reminder.key}
          role="status"
          className="pointer-events-auto animate-rise rounded-xl border border-[var(--accent)] bg-surface-1 p-3 shadow-[var(--shadow-panel)]"
        >
          <div className="flex items-start gap-2.5">
            <span aria-hidden className="text-lg leading-none">
              {reminder.kind === 'task' ? '☑' : '🔔'}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{reminder.title}</p>
              <p className="truncate text-xs text-ink-dim">{reminder.body}</p>
            </div>
            <button
              type="button"
              onClick={() => setBanners((c) => c.filter((b) => b.key !== reminder.key))}
              aria-label="Закрыть напоминание"
              className="shrink-0 rounded px-1.5 text-xs font-semibold text-ink-faint hover:bg-surface-2"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
