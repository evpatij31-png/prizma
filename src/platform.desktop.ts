/**
 * Desktop wiring, loaded only by the Tauri build.
 *
 * It replaces two implementations and nothing else — see `platform.ts`. No
 * component or library module imports this file, which is what keeps the web
 * build free of Tauri and keeps "which platform am I on" out of the UI.
 *
 * NOT COMPILED OR RUN ANYWHERE YET: this machine has no Rust toolchain, so
 * none of it has been executed. Treat it as a starting point to verify on a
 * machine that can build the desktop app, not as working code.
 */

import { registerPlatform } from './platform.ts'
import { FeedError, normaliseUrl, type Fetcher } from './lib/feed.ts'
import type { NotificationSink } from './lib/reminders.ts'

/**
 * Feeds over the native HTTP plugin.
 *
 * This is the reason the desktop shell exists: the request never passes
 * through a web origin, so the missing CORS header on Google's and iCloud's
 * feeds stops mattering.
 */
const desktopFetcher: Fetcher = {
  async fetchText(url) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
    const response = await tauriFetch(normaliseUrl(url), { method: 'GET' })
    if (!response.ok) throw new FeedError(`Сервер ответил ${response.status}`, 'http', response.status)
    const text = await response.text()
    if (!text.includes('BEGIN:VCALENDAR')) throw new FeedError('По ссылке лежит не календарь', 'empty')
    return text
  },
}

const desktopSink: NotificationSink = {
  show(reminder) {
    void (async () => {
      const { isPermissionGranted, requestPermission, sendNotification } = await import(
        '@tauri-apps/plugin-notification'
      )
      let granted = await isPermissionGranted()
      if (!granted) granted = (await requestPermission()) === 'granted'
      if (granted) sendNotification({ title: reminder.title, body: reminder.body })
    })()
  },
}

export function initDesktop(): void {
  registerPlatform({ name: 'desktop', fetcher: desktopFetcher, sink: desktopSink })
}
