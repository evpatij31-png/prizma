import { useEffect, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'

/** Remembers a declined install offer, so it is not asked again. */
const DECLINED_KEY = 'prizma.install.declined'
/** Counts visits, so the offer waits until the app has been used. */
const VISITS_KEY = 'prizma.visits'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/**
 * The two things a web app has to ask about: a new version, and installing.
 *
 * Both are offers, never actions. A page that reloads itself loses whatever
 * was half-typed in the editor, and an install prompt on first contact is
 * dismissed without being read — which is a decision the browser then
 * remembers against you.
 */
export function PwaPrompts() {
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [updateApp, setUpdateApp] = useState<(() => void) | null>(null)
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    const update = registerSW({
      onNeedRefresh: () => setNeedsRefresh(true),
      onOfflineReady: () => setOffline(true),
    })
    setUpdateApp(() => () => void update(true))
  }, [])

  useEffect(() => {
    if (!offline) return
    const id = setTimeout(() => setOffline(false), 6000)
    return () => clearTimeout(id)
  }, [offline])

  useEffect(() => {
    const visits = Number(localStorage.getItem(VISITS_KEY) ?? '0') + 1
    localStorage.setItem(VISITS_KEY, String(visits))

    const onPrompt = (event: Event) => {
      event.preventDefault()
      // Not on the first visit: an offer made before the app has been used is
      // refused reflexively, and the browser treats that refusal as final.
      if (visits < 2 || localStorage.getItem(DECLINED_KEY)) return
      setInstallEvent(event as BeforeInstallPromptEvent)
    }

    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  const install = async () => {
    const event = installEvent
    setInstallEvent(null)
    if (!event) return
    await event.prompt()
    const { outcome } = await event.userChoice
    if (outcome === 'dismissed') localStorage.setItem(DECLINED_KEY, '1')
  }

  if (!needsRefresh && !installEvent && !offline) return null

  return (
    <div className="pad-safe-b pointer-events-none fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-sm flex-col gap-2">
      {offline && (
        <Banner icon="✓" title="Готово к работе без сети" />
      )}

      {needsRefresh && (
        <Banner
          icon="↻"
          title="Доступна новая версия"
          body="Обновление применится после перезагрузки."
          action={{ label: 'Обновить', onClick: () => updateApp?.() }}
          onDismiss={() => setNeedsRefresh(false)}
        />
      )}

      {installEvent && (
        <Banner
          icon="＋"
          title="Установить Prizma?"
          body="Откроется отдельным окном и будет работать без сети."
          action={{ label: 'Установить', onClick: () => void install() }}
          onDismiss={() => {
            localStorage.setItem(DECLINED_KEY, '1')
            setInstallEvent(null)
          }}
        />
      )}
    </div>
  )
}

function Banner({
  icon,
  title,
  body,
  action,
  onDismiss,
}: {
  icon: string
  title: string
  body?: string
  action?: { label: string; onClick(): void }
  onDismiss?(): void
}) {
  return (
    <div
      role="status"
      className="pointer-events-auto animate-rise rounded-xl border border-edge bg-surface-1 p-3 shadow-[var(--shadow-panel)]"
    >
      <div className="flex items-start gap-2.5">
        <span aria-hidden className="text-base leading-none text-[var(--accent)]">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">{title}</p>
          {body && <p className="mt-0.5 text-[11px] text-ink-dim">{body}</p>}
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Закрыть"
            className="shrink-0 rounded px-1.5 text-xs font-semibold text-ink-faint hover:bg-surface-2"
          >
            ✕
          </button>
        )}
      </div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-2 w-full rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-bold text-[var(--accent-text)]"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
