import clsx from 'clsx'

import { useStore } from '../store/useStore.ts'
import { titleFor, VIEW_LABELS } from '../lib/view.ts'
import * as dt from '../lib/datetime.ts'
import type { ViewMode } from '../lib/types.ts'

const VIEW_ORDER: ViewMode[] = ['month', 'week', 'day', 'agenda']

interface Props {
  onToggleSidebar(): void
  onSearch(): void
}

export function Header({ onToggleSidebar, onSearch }: Props) {
  const view = useStore((s) => s.view)
  const cursor = useStore((s) => s.cursor)
  const weekStart = useStore((s) => s.settings.weekStart)
  const loading = useStore((s) => s.loading)
  const setView = useStore((s) => s.setView)
  const step = useStore((s) => s.step)
  const goToday = useStore((s) => s.goToday)
  const startNewEvent = useStore((s) => s.startNewEvent)
  const defaultMinutes = useStore((s) => s.settings.defaultEventMinutes)

  const atToday = dt.dateOf(cursor) === dt.today()

  return (
    <header className="pad-safe-t flex shrink-0 flex-wrap items-center gap-2 border-b border-edge bg-surface-1/80 px-3 py-2 backdrop-blur-xl">
      <button
        type="button"
        onClick={onToggleSidebar}
        className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-dim hover:bg-surface-2 hover:text-ink lg:hidden"
        aria-label="Календари"
      >
        <svg viewBox="0 0 20 20" className="size-5" fill="currentColor" aria-hidden>
          <path d="M3 5h14v2H3zM3 9h14v2H3zM3 13h14v2H3z" />
        </svg>
      </button>

      <div className="flex items-center gap-0.5">
        <IconButton label="Назад" onClick={() => void step(-1)}>
          <path d="M12.5 4 7 10l5.5 6" />
        </IconButton>
        <IconButton label="Вперёд" onClick={() => void step(1)}>
          <path d="M7.5 4 13 10l-5.5 6" />
        </IconButton>
      </div>

      <button
        type="button"
        onClick={() => void goToday()}
        disabled={atToday}
        className={clsx(
          'shrink-0 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors',
          atToday
            ? 'border-edge text-ink-faint'
            : 'border-edge-strong text-ink-dim hover:border-[var(--accent)] hover:text-ink',
        )}
      >
        Сегодня
      </button>

      {/* On a phone the title drops to its own row: sharing one with six
          controls truncated "Ноябрь 2026" to "Нояб…", losing the year. */}
      <h1 className="order-last w-full min-w-0 truncate text-base font-bold tracking-tight sm:order-none sm:w-auto sm:flex-1 sm:text-xl">
        {titleFor(view, cursor, weekStart)}
        {loading && (
          <span
            aria-live="polite"
            className="ml-2 align-middle text-[11px] font-normal text-ink-faint"
          >
            загрузка…
          </span>
        )}
      </h1>

      <button
        type="button"
        onClick={onSearch}
        aria-label="Поиск"
        title="Поиск (/)"
        className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-dim transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <svg viewBox="0 0 20 20" className="size-4.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="9" cy="9" r="5.5" />
          <path d="m13.5 13.5 3 3" strokeLinecap="round" />
        </svg>
      </button>

      <button
        type="button"
        onClick={() => {
          const start = `${dt.dateOf(cursor)}T09:00`
          startNewEvent(start, dt.addMinutes(start, defaultMinutes), false)
        }}
        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-bold text-[var(--accent-text)] transition-transform hover:-translate-y-px active:translate-y-0"
        title="Новое событие (N)"
      >
        <span aria-hidden className="text-sm leading-none">
          +
        </span>
        <span className="hidden sm:inline">Событие</span>
      </button>

      <nav
        aria-label="Вид"
        className="order-last flex shrink-0 gap-0.5 rounded-xl border border-edge bg-surface-2 p-0.5 sm:order-none"
      >
        {VIEW_ORDER.map((mode) => {
          const active = mode === view
          const { label, hotkey } = VIEW_LABELS[mode]
          return (
            <button
              key={mode}
              type="button"
              onClick={() => void setView(mode)}
              aria-pressed={active}
              title={`${label} (${hotkey})`}
              className={clsx(
                'rounded-[10px] px-2.5 py-1.5 text-xs font-semibold transition-all duration-150',
                active
                  ? 'bg-[var(--accent)] text-[var(--accent-text)] shadow-sm'
                  : 'text-ink-dim hover:bg-surface-3 hover:text-ink',
              )}
            >
              {label}
            </button>
          )
        })}
      </nav>
    </header>
  )
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick(): void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid size-9 place-items-center rounded-lg text-ink-dim transition-colors hover:bg-surface-2 hover:text-ink"
    >
      <svg
        viewBox="0 0 20 20"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {children}
      </svg>
    </button>
  )
}
