/**
 * The two things the desktop and mobile wrappers replace.
 *
 * Both platform shells exist for exactly these capabilities:
 *
 *   - **fetcher** — a request made from a native layer is not subject to CORS,
 *     so the Google and iCloud feeds that the browser refuses can be read.
 *     This is the real reason the wrappers are part of V1 rather than a nicety.
 *   - **sink** — a notification held by the operating system arrives with the
 *     app closed, which a web notification does not reliably do.
 *
 * Everything else is the same build. A wrapper calls `registerPlatform` once
 * at startup and changes nothing else; no module below this one branches on
 * which platform it is running on.
 */

import { webFetcher, type Fetcher } from './lib/feed.ts'
import { webSink, type NotificationSink } from './lib/reminders.ts'

export interface Platform {
  fetcher: Fetcher
  sink: NotificationSink
  /** Short name, for diagnostics and the settings screen. */
  name: 'web' | 'desktop' | 'mobile'
}

const current: Platform = {
  fetcher: webFetcher,
  sink: webSink,
  name: 'web',
}

/** Called once by a wrapper before the app mounts. */
export function registerPlatform(overrides: Partial<Platform>): void {
  Object.assign(current, overrides)
}

export function platform(): Platform {
  return current
}

/** True where feeds can be fetched without a CORS allowance. */
export function canReadAnyFeed(): boolean {
  return current.name !== 'web'
}

/* -------------------------------- detection ------------------------------- */

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function isCapacitor(): boolean {
  if (typeof window === 'undefined') return false
  const cap = (window as { Capacitor?: { isNativePlatform?(): boolean } }).Capacitor
  return cap?.isNativePlatform?.() === true
}

/**
 * Pick the implementations for wherever this is running, and wait for them.
 *
 * Called once before the app mounts. It must finish *before* the first render,
 * because `init()` kicks off a feed refresh immediately — start rendering
 * first and the desktop build would make its opening request through the
 * browser fetcher and hit the very CORS wall the wrapper exists to avoid.
 *
 * The imports are dynamic so the web bundle never pulls in Tauri or
 * Capacitor: neither branch is reachable in a browser, and the bundler drops
 * the chunks accordingly.
 */
export async function bootstrapPlatform(): Promise<Platform['name']> {
  try {
    if (isTauri()) {
      const { initDesktop } = await import('./platform.desktop.ts')
      initDesktop()
    } else if (isCapacitor()) {
      const { initMobile } = await import('./platform.mobile.ts')
      initMobile()
    }
  } catch (error) {
    // A wrapper that fails to load is a degraded app, not a dead one: the web
    // implementations still work, feeds just stay limited to CORS-friendly
    // hosts. Better that than a blank window.
    console.error('[platform] native layer failed to load, staying on web', error)
  }
  return current.name
}
