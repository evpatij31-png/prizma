import { useState } from 'react'
import clsx from 'clsx'

import { permissionState, requestPermission } from '../../lib/reminders.ts'
import { useStore } from '../../store/useStore.ts'

/**
 * The notification toggle, and the sentence next to it.
 *
 * That sentence is a requirement, not decoration: web notifications are not
 * guaranteed while the app is fully closed, and a user who believes otherwise
 * will miss a meeting because of it. The honest line costs nothing; the
 * missing one costs trust.
 */
export function NotificationSettings() {
  const enabled = useStore((s) => s.settings.notificationsEnabled)
  const updateSettings = useStore((s) => s.updateSettings)
  const [state, setState] = useState(permissionState)

  const ask = async () => {
    const granted = await requestPermission()
    setState(permissionState())
    await updateSettings({ notificationsEnabled: granted })
  }

  const denied = state === 'denied'
  const unsupported = state === 'unsupported'

  return (
    <section className="shrink-0">
      <h2 className="px-1 pb-2 text-[11px] font-bold tracking-wider text-ink-faint uppercase">
        Напоминания
      </h2>

      {unsupported ? (
        <p className="px-1 text-[11px] text-ink-faint">
          Этот браузер не умеет системные уведомления. Напоминания будут появляться плашкой в
          приложении.
        </p>
      ) : (
        <>
          <button
            type="button"
            onClick={() => void ask()}
            disabled={denied || (enabled && state === 'granted')}
            className={clsx(
              'w-full rounded-lg border px-2.5 py-2 text-left text-xs font-semibold transition-colors',
              state === 'granted'
                ? 'border-edge text-ink-dim'
                : 'border-edge-strong text-ink hover:border-[var(--accent)]',
              denied && 'opacity-60',
            )}
          >
            {state === 'granted'
              ? 'Системные уведомления включены'
              : denied
                ? 'Уведомления запрещены в браузере'
                : 'Включить системные уведомления'}
          </button>

          {denied && (
            <p className="mt-1 px-1 text-[11px] text-ink-faint">
              Разрешение сбрасывается в настройках сайта в браузере — отсюда его запросить
              повторно нельзя.
            </p>
          )}
        </>
      )}

      <p className="mt-2 px-1 text-[11px] leading-snug text-ink-faint">
        Пока приложение открыто, напоминания приходят всегда. При полностью закрытом приложении
        веб-уведомления не гарантированы — особенно на iPhone. Надёжно они работают в мобильном
        приложении.
      </p>
    </section>
  )
}
