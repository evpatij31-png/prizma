import { useState } from 'react'
import clsx from 'clsx'

import { useStore } from '../store/useStore.ts'
import { swatch } from '../lib/colors.ts'
import { TaskPanel } from './tasks/TaskPanel.tsx'
import { NotificationSettings } from './settings/NotificationSettings.tsx'
import { DataSheet } from './settings/DataSheet.tsx'
import type { Settings } from '../lib/types.ts'

const THEMES: { value: Settings['theme']; label: string }[] = [
  { value: 'dark', label: 'Тёмная' },
  { value: 'light', label: 'Светлая' },
  { value: 'system', label: 'Как в системе' },
]

export function Sidebar() {
  const calendars = useStore((s) => s.calendars)
  const setCalendarVisible = useStore((s) => s.setCalendarVisible)
  const theme = useStore((s) => s.settings.theme)
  const showTasksInGrid = useStore((s) => s.settings.showTasksInGrid)
  const showCompleted = useStore((s) => s.settings.showCompletedTasks)
  const updateSettings = useStore((s) => s.updateSettings)
  const [dataOpen, setDataOpen] = useState(false)

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-3">
      <section className="shrink-0">
        <h2 className="px-1 pb-2 text-[11px] font-bold tracking-wider text-ink-faint uppercase">
          Календари
        </h2>
        <ul className="flex max-h-44 flex-col gap-0.5 overflow-y-auto scroll-thin">
          {calendars.map((calendar) => {
            const color = swatch(calendar.color)
            return (
              <li key={calendar.id}>
                <label
                  className={clsx(
                    'flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm',
                    'transition-colors hover:bg-surface-2',
                    !calendar.visible && 'opacity-55',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={calendar.visible}
                    onChange={(e) => void setCalendarVisible(calendar.id, e.target.checked)}
                    className="size-4 shrink-0 cursor-pointer rounded accent-[var(--accent)]"
                  />
                  <span
                    aria-hidden
                    className="size-3 shrink-0 rounded-full"
                    style={{ background: color.dot }}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">{calendar.name}</span>
                  {calendar.readOnly && (
                    <span className="shrink-0 text-[10px] text-ink-faint" title="Только чтение">
                      🔒
                    </span>
                  )}
                </label>
              </li>
            )
          })}
        </ul>
        {calendars.length === 0 && (
          <p className="px-2 text-xs text-ink-faint">Календарей пока нет.</p>
        )}
      </section>

      <TaskPanel />

      <section className="shrink-0">
        <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs hover:bg-surface-2">
          <input
            type="checkbox"
            checked={showTasksInGrid}
            onChange={(e) => void updateSettings({ showTasksInGrid: e.target.checked })}
            className="size-3.5 shrink-0 cursor-pointer rounded accent-[var(--accent)]"
          />
          <span className="font-medium text-ink-dim">Задачи в сетке</span>
        </label>
        <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs hover:bg-surface-2">
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={(e) => void updateSettings({ showCompletedTasks: e.target.checked })}
            className="size-3.5 shrink-0 cursor-pointer rounded accent-[var(--accent)]"
          />
          <span className="font-medium text-ink-dim">Показывать выполненные</span>
        </label>
      </section>

      <button
        type="button"
        onClick={() => setDataOpen(true)}
        className="shrink-0 rounded-lg border border-edge-strong px-2.5 py-2 text-xs font-semibold text-ink-dim transition-colors hover:border-[var(--accent)] hover:text-ink"
      >
        Данные и подписки…
      </button>
      {dataOpen && <DataSheet onClose={() => setDataOpen(false)} />}

      <NotificationSettings />

      <section className="shrink-0">
        <h2 className="px-1 pb-2 text-[11px] font-bold tracking-wider text-ink-faint uppercase">
          Тема
        </h2>
        <div className="flex gap-0.5 rounded-xl border border-edge bg-surface-2 p-0.5">
          {THEMES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => void updateSettings({ theme: option.value })}
              aria-pressed={theme === option.value}
              className={clsx(
                'flex-1 rounded-[10px] px-2 py-1.5 text-[11px] font-semibold transition-colors',
                theme === option.value
                  ? 'bg-[var(--accent)] text-[var(--accent-text)]'
                  : 'text-ink-dim hover:bg-surface-3 hover:text-ink',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
