/**
 * Mobile wiring, loaded only by the Capacitor build.
 *
 * Replaces the same two implementations as the desktop shell and nothing
 * else. `reminders.ts` and `feed.ts` are not edited for either platform —
 * that is the whole point of the seam in `platform.ts`.
 *
 * NOT BUILT OR RUN ANYWHERE: no Xcode, no Android Studio on this machine.
 * Typechecked only.
 */

import { registerPlatform } from './platform.ts'
import { FeedError, normaliseUrl, type Fetcher } from './lib/feed.ts'
import type { NotificationSink, ScheduledReminder } from './lib/reminders.ts'
import * as dt from './lib/datetime.ts'

/** iOS will not hold more than this many pending local notifications. */
const IOS_PENDING_LIMIT = 64

const mobileFetcher: Fetcher = {
  async fetchText(url) {
    const { CapacitorHttp } = await import('@capacitor/core')
    const response = await CapacitorHttp.get({ url: normaliseUrl(url), responseType: 'text' })
    if (response.status < 200 || response.status >= 300) {
      throw new FeedError(`Сервер ответил ${response.status}`, 'http', response.status)
    }
    const text = typeof response.data === 'string' ? response.data : String(response.data ?? '')
    if (!text.includes('BEGIN:VCALENDAR')) throw new FeedError('По ссылке лежит не календарь', 'empty')
    return text
  },
}

/**
 * Hands the reminder to the operating system.
 *
 * This is the capability the web cannot provide: a notification the system
 * holds arrives with the app closed, which is what makes a reminder worth
 * relying on.
 */
const mobileSink: NotificationSink = {
  show(reminder) {
    void (async () => {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      const permission = await LocalNotifications.checkPermissions()
      if (permission.display !== 'granted') {
        const asked = await LocalNotifications.requestPermissions()
        if (asked.display !== 'granted') return
      }
      await LocalNotifications.schedule({
        notifications: [
          {
            id: hashId(reminder.key),
            title: reminder.title,
            body: reminder.body,
          },
        ],
      })
    })()
  },
}

/**
 * Schedule reminders with the system rather than with a timer in the page.
 *
 * Called at startup and after any edit. Capped at the iOS limit and sorted by
 * time, so the ones that are dropped are the furthest away — losing a
 * reminder for next month is survivable, losing tomorrow's is not.
 */
export async function scheduleNatively(reminders: ScheduledReminder[]): Promise<number> {
  const { LocalNotifications } = await import('@capacitor/local-notifications')

  const pending = await LocalNotifications.getPending()
  if (pending.notifications.length) await LocalNotifications.cancel(pending)

  const now = dt.now()
  const upcoming = reminders
    .filter((r) => r.at > now)
    .sort((a, b) => (a.at < b.at ? -1 : 1))
    .slice(0, IOS_PENDING_LIMIT)

  if (!upcoming.length) return 0

  await LocalNotifications.schedule({
    notifications: upcoming.map((r) => ({
      id: hashId(r.key),
      title: r.title,
      body: r.body,
      schedule: { at: dt.toDate(r.at) },
    })),
  })
  return upcoming.length
}

/** A stable 31-bit id from the reminder key; the native API wants a number. */
function hashId(key: string): number {
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % 2_147_483_647
}

export function initMobile(): void {
  registerPlatform({ name: 'mobile', fetcher: mobileFetcher, sink: mobileSink })
}
