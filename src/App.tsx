import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'

import { Header } from './components/Header.tsx'
import { Sidebar } from './components/Sidebar.tsx'
import { MonthView } from './components/month/MonthView.tsx'
import { WeekView } from './components/week/WeekView.tsx'
import { AgendaView } from './components/agenda/AgendaView.tsx'
import { EventEditor } from './components/editor/EventEditor.tsx'
import { SeriesScopeDialog } from './components/editor/SeriesScopeDialog.tsx'
import { ReminderHost } from './components/ReminderHost.tsx'
import { Search } from './components/Search.tsx'
import { PwaPrompts } from './components/PwaPrompts.tsx'
import { useStore } from './store/useStore.ts'
import { useOccurrences } from './store/selectors.ts'
import { resolveHotkey } from './lib/hotkeys.ts'
import * as dt from './lib/datetime.ts'

export function App() {
  const ready = useStore((s) => s.ready)
  const view = useStore((s) => s.view)
  const cursor = useStore((s) => s.cursor)
  const weekStart = useStore((s) => s.settings.weekStart)
  const init = useStore((s) => s.init)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  const weekDates = useMemo(() => dt.weekDates(cursor, weekStart), [cursor, weekStart])
  const dayDates = useMemo(() => [dt.dateOf(cursor)], [cursor])

  useEffect(() => {
    void init()
  }, [init])

  useHotkeys({ searchOpen, setSearchOpen, setSidebarOpen })

  if (!ready) return <Splash />

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Header onToggleSidebar={() => setSidebarOpen((v) => !v)} onSearch={() => setSearchOpen(true)} />

      <div className="flex min-h-0 flex-1">
        {/* Permanent on wide screens, a sheet on narrow ones. */}
        <aside className="hidden w-60 shrink-0 border-r border-edge bg-surface-1/60 lg:block">
          <Sidebar />
        </aside>

        {sidebarOpen && (
          <>
            <button
              type="button"
              aria-label="Закрыть панель"
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 z-30 bg-black/50 lg:hidden"
            />
            <aside className="pad-safe-t fixed inset-y-0 left-0 z-40 w-72 max-w-[85vw] border-r border-edge bg-surface-1 shadow-[var(--shadow-panel)] lg:hidden">
              <Sidebar />
            </aside>
          </>
        )}

        <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {view === 'month' && <MonthView />}
          {view === 'week' && <WeekView dates={weekDates} />}
          {view === 'day' && <WeekView dates={dayDates} />}
          {view === 'agenda' && <AgendaView />}
        </main>

        <EventEditor />
        <SeriesScopeDialog />
      </div>

      {searchOpen && <Search onClose={() => setSearchOpen(false)} />}
      <ReminderHost />
      <PwaPrompts />
      <ErrorToast />
    </div>
  )
}

/**
 * Global shortcuts.
 *
 * Everything is read through `resolveHotkey`, which knows about layouts and
 * about not stealing keys from a field the user is typing in.
 */
function useHotkeys({
  searchOpen,
  setSearchOpen,
  setSidebarOpen,
}: {
  searchOpen: boolean
  setSearchOpen(open: boolean): void
  setSidebarOpen(open: boolean): void
}) {
  const occurrences = useOccurrences()

  const onKey = useCallback(
    (event: KeyboardEvent) => {
      const action = resolveHotkey({
        code: event.code,
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        target: event.target,
      })
      if (!action) return

      const store = useStore.getState()

      // While a panel is open its own Escape handler has already run; this one
      // only has to close the things the panels do not own.
      if (action === 'close') {
        setSearchOpen(false)
        setSidebarOpen(false)
        if (!store.editor && !store.pendingScope) store.select(null)
        return
      }
      if (searchOpen) return
      if (store.editor || store.pendingScope) return

      event.preventDefault()
      switch (action) {
        case 'view-month':
          void store.setView('month')
          break
        case 'view-week':
          void store.setView('week')
          break
        case 'view-day':
          void store.setView('day')
          break
        case 'view-agenda':
          void store.setView('agenda')
          break
        case 'today':
          void store.goToday()
          break
        case 'prev':
          void store.step(-1)
          break
        case 'next':
          void store.step(1)
          break
        case 'new-event': {
          const start = `${dt.dateOf(store.cursor)}T09:00`
          store.startNewEvent(start, dt.addMinutes(start, store.settings.defaultEventMinutes), false)
          break
        }
        case 'search':
          setSearchOpen(true)
          break
        case 'delete': {
          const selected = occurrences.find((o) => o.key === store.selectedKey)
          if (selected && !selected.readOnly) void store.deleteOccurrence(selected)
          break
        }
      }
    },
    [occurrences, searchOpen, setSearchOpen, setSidebarOpen],
  )

  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])
}

function Splash() {
  return (
    <div className="grid h-full place-items-center">
      <div className="flex flex-col items-center gap-3 text-ink-faint">
        <div className="size-10 animate-spin rounded-full border-2 border-edge border-t-[var(--accent)]" />
        <p className="text-sm">Открываем календарь…</p>
      </div>
    </div>
  )
}

function ErrorToast() {
  const error = useStore((s) => s.error)
  const dismiss = useStore((s) => s.dismissError)
  if (!error) return null
  return (
    <div
      role="alert"
      className={clsx(
        'pad-safe-b fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md items-start gap-3',
        'rounded-xl border border-[var(--now-line)] bg-surface-1 p-3 shadow-[var(--shadow-panel)]',
      )}
    >
      <span aria-hidden className="text-lg leading-none">
        ⚠️
      </span>
      <p className="min-w-0 flex-1 text-sm text-ink">{error}</p>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 rounded px-2 py-0.5 text-xs font-semibold text-ink-dim hover:bg-surface-2"
      >
        Закрыть
      </button>
    </div>
  )
}
