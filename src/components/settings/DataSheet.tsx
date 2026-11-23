import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'

import * as dt from '../../lib/datetime.ts'
import { exportDump, events as eventStore, type Dump, type ImportMode } from '../../lib/db.ts'
import { downloadIcs, downloadJson } from '../../lib/download.ts'
import { icsFileName, parseIcs, serializeIcs } from '../../lib/ics.ts'
import { swatch } from '../../lib/colors.ts'
import { canReadAnyFeed } from '../../platform.ts'
import { useStore } from '../../store/useStore.ts'

type Pending =
  | { kind: 'ics'; text: string; events: number; skipped: number; name?: string }
  | { kind: 'backup'; dump: Dump }

/**
 * Everything that crosses the app's boundary: subscriptions, .ics files and
 * the full backup.
 *
 * Every import shows what it found *before* writing anything. Importing a
 * file is the one action here that can quietly mangle a calendar, and "341
 * events, 2 unreadable" is the difference between a decision and a leap.
 */
export function DataSheet({ onClose }: { onClose(): void }) {
  const calendars = useStore((s) => s.calendars)
  const importIcs = useStore((s) => s.importIcs)
  const addFeed = useStore((s) => s.addFeed)
  const refreshFeed = useStore((s) => s.refreshFeed)
  const removeCalendar = useStore((s) => s.removeCalendar)
  const restoreBackup = useStore((s) => s.restoreBackup)

  const writable = calendars.filter((c) => !c.readOnly)
  const feeds = calendars.filter((c) => c.kind === 'ics-feed')

  const [url, setUrl] = useState('')
  const [feedName, setFeedName] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [target, setTarget] = useState(writable[0]?.id ?? '')
  const [mode, setMode] = useState<ImportMode>('merge')
  const icsInput = useRef<HTMLInputElement>(null)
  const backupInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true)
    setNote(null)
    const message = await fn()
    setBusy(false)
    if (message) setNote(message)
  }

  const pickIcs = async (file: File) => {
    const text = await file.text()
    const parsed = parseIcs(text)
    setNote(null)
    setPending({ kind: 'ics', text, events: parsed.events.length, skipped: parsed.skipped, name: parsed.calendarName })
    if (!target && writable[0]) setTarget(writable[0].id)
  }

  const pickBackup = async (file: File) => {
    try {
      const dump = JSON.parse(await file.text()) as Dump
      setNote(null)
      setPending({ kind: 'backup', dump })
    } catch {
      setNote('Этот файл не похож на резервную копию')
    }
  }

  const exportIcs = async (calendarId: string) => {
    const calendar = calendars.find((c) => c.id === calendarId)
    const list = calendarId === 'all' ? await allEvents() : await eventStore.byCalendar(calendarId)
    downloadIcs(icsFileName(calendarId === 'all' ? undefined : calendar), serializeIcs(list, { calendarName: calendar?.name }))
    setNote(`Выгружено событий: ${list.length}`)
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-end sm:place-items-center">
      <button type="button" aria-label="Закрыть" onClick={onClose} className="absolute inset-0 bg-black/55" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Данные и подписки"
        className="pad-safe-b relative flex max-h-[88vh] w-full flex-col rounded-t-2xl border border-edge bg-surface-1 shadow-[var(--shadow-panel)] sm:max-w-lg sm:rounded-2xl"
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-edge px-4 py-3">
          <h2 className="flex-1 text-sm font-bold">Данные и подписки</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="grid size-7 place-items-center rounded-lg text-ink-dim hover:bg-surface-2"
          >
            ✕
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto scroll-thin p-4">
          {note && (
            <p role="status" className="rounded-lg bg-accent-soft px-3 py-2 text-xs font-semibold text-ink">
              {note}
            </p>
          )}

          {pending?.kind === 'ics' && (
            <Confirm
              title={`Найдено событий: ${pending.events}${pending.skipped ? `, не удалось прочитать: ${pending.skipped}` : ''}`}
              hint={pending.name ? `Календарь в файле: «${pending.name}»` : undefined}
              disabled={!target || busy}
              onCancel={() => setPending(null)}
              onConfirm={async () => {
                const text = pending.text
                setPending(null)
                await run(async () => {
                  const r = await importIcs(text, target)
                  return `Добавлено ${r.added}, обновлено ${r.updated}${r.skipped ? `, пропущено ${r.skipped}` : ''}`
                })
              }}
            >
              <Select value={target} onChange={setTarget} label="Куда импортировать">
                {writable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Confirm>
          )}

          {pending?.kind === 'backup' && (
            <Confirm
              title={`В копии: календарей ${live(pending.dump.calendars)}, событий ${live(pending.dump.events)}, задач ${live(pending.dump.tasks)}`}
              hint={
                mode === 'replace'
                  ? 'Текущие данные будут стёрты и заменены копией. Это необратимо.'
                  : 'Записи с одинаковым идентификатором: останется та, что изменена позже.'
              }
              disabled={busy}
              onCancel={() => setPending(null)}
              onConfirm={async () => {
                const dump = pending.dump
                setPending(null)
                await run(() => restoreBackup(dump, mode))
              }}
            >
              <Select value={mode} onChange={(v) => setMode(v as ImportMode)} label="Как восстановить">
                <option value="merge">Объединить с текущими</option>
                <option value="replace">Заменить всё</option>
              </Select>
            </Confirm>
          )}

          {/* ------------------------------ feeds ------------------------------ */}
          <section>
            <h3 className="pb-2 text-[11px] font-bold tracking-wider text-ink-faint uppercase">Подписки</h3>

            <p className="mb-2 text-[11px] leading-snug text-ink-faint">
              Google, iCloud и Outlook дают секретную ссылку на ваш календарь.{' '}
              {canReadAnyFeed() ? (
                <>
                  Здесь она читается по ссылке: запрос идёт мимо браузера, и ограничение CORS
                  не применяется.
                </>
              ) : (
                <>
                  Но браузер не пускает запросы к этим адресам (CORS), поэтому в вебе работают
                  только ленты, которые это сами разрешают. По ссылке они читаются в десктопном
                  и мобильном приложении.
                </>
              )}
            </p>

            <div className="flex flex-col gap-1.5">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://… или webcal://…"
                aria-label="Ссылка на календарь"
                className={inputClass}
              />
              <div className="flex gap-1.5">
                <input
                  value={feedName}
                  onChange={(e) => setFeedName(e.target.value)}
                  placeholder="Название (необязательно)"
                  aria-label="Название подписки"
                  className={clsx(inputClass, 'flex-1')}
                />
                <button
                  type="button"
                  disabled={!url.trim() || busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await addFeed(url, feedName)
                      if (result) {
                        setUrl('')
                        setFeedName('')
                      }
                      return result
                    })
                  }
                  className={primaryButton}
                >
                  Подписаться
                </button>
              </div>
            </div>

            {feeds.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1">
                {feeds.map((feed) => (
                  <li key={feed.id} className="rounded-lg border border-edge bg-surface-2 p-2">
                    <div className="flex items-center gap-2">
                      <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: swatch(feed.color).dot }} />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{feed.name}</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void run(() => refreshFeed(feed.id))}
                        className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-ink-dim hover:bg-surface-3 hover:text-ink"
                      >
                        Обновить
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeCalendar(feed.id)}
                        className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-[var(--now-line)] hover:bg-surface-3"
                      >
                        Удалить
                      </button>
                    </div>
                    <p className="mt-0.5 truncate text-[10px] text-ink-faint">{feed.url}</p>
                    {feed.lastSyncError ? (
                      <p className="mt-1 text-[11px] leading-snug text-[var(--now-line)]">{feed.lastSyncError}</p>
                    ) : (
                      feed.lastSyncAt && (
                        <p className="mt-0.5 text-[10px] text-ink-faint">
                          Обновлено {dt.formatRelativeDay(dt.fromDate(new Date(feed.lastSyncAt)))},{' '}
                          {dt.formatTime(dt.fromDate(new Date(feed.lastSyncAt)))}
                        </p>
                      )
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ------------------------------- files ----------------------------- */}
          <section>
            <h3 className="pb-2 text-[11px] font-bold tracking-wider text-ink-faint uppercase">Файл .ics</h3>
            <div className="flex flex-wrap gap-1.5">
              <input
                ref={icsInput}
                type="file"
                accept=".ics,text/calendar"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void pickIcs(file)
                  e.target.value = ''
                }}
              />
              <button type="button" onClick={() => icsInput.current?.click()} className={secondaryButton}>
                Импортировать…
              </button>
              <Select value={target || 'all'} onChange={setTarget} label="" compact>
                <option value="all">Все календари</option>
                {calendars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <button type="button" onClick={() => void exportIcs(target || 'all')} className={secondaryButton}>
                Экспортировать
              </button>
            </div>
          </section>

          {/* ------------------------------ backup ----------------------------- */}
          <section>
            <h3 className="pb-2 text-[11px] font-bold tracking-wider text-ink-faint uppercase">Резервная копия</h3>
            <p className="mb-2 text-[11px] leading-snug text-ink-faint">
              Полный слепок: календари, события, задачи и настройки. Пока нет облака, это
              единственный способ перенести данные на другое устройство.
            </p>
            <div className="flex flex-wrap gap-1.5">
              <input
                ref={backupInput}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void pickBackup(file)
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                onClick={() =>
                  void run(async () => {
                    const dump = await exportDump()
                    downloadJson(`prizma-backup-${dt.today()}.json`, dump)
                    return `Сохранено: событий ${dump.events.length}, задач ${dump.tasks.length}`
                  })
                }
                className={secondaryButton}
              >
                Сохранить копию
              </button>
              <button type="button" onClick={() => backupInput.current?.click()} className={secondaryButton}>
                Восстановить…
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

async function allEvents() {
  return eventStore.list()
}

/**
 * Count only records the user would recognise.
 *
 * A backup deliberately carries tombstones — dropping them would resurrect
 * deleted items on restore — but counting them in the preview reports more
 * events than the calendar has ever shown, which reads as corruption.
 */
function live(records: { deletedAt?: number | null }[] | undefined): number {
  return (records ?? []).filter((r) => r.deletedAt == null).length
}

const inputClass =
  'w-full rounded-lg border border-edge bg-surface-2 px-2.5 py-2 text-sm outline-none transition-colors focus:border-[var(--accent)]'
const primaryButton =
  'shrink-0 rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-bold text-[var(--accent-text)] disabled:opacity-50'
const secondaryButton =
  'rounded-lg border border-edge-strong px-3 py-2 text-xs font-semibold text-ink-dim transition-colors hover:border-[var(--accent)] hover:text-ink'

function Select({
  value,
  onChange,
  label,
  compact,
  children,
}: {
  value: string
  onChange(v: string): void
  label: string
  compact?: boolean
  children: React.ReactNode
}) {
  return (
    <label className={compact ? '' : 'block'}>
      {label && (
        <span className="mb-1 block text-[11px] font-bold tracking-wide text-ink-faint uppercase">{label}</span>
      )}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label || undefined}
        className={clsx(inputClass, compact && 'w-auto py-2')}
      >
        {children}
      </select>
    </label>
  )
}

/** A preview with an explicit confirm, shown before anything is written. */
function Confirm({
  title,
  hint,
  disabled,
  onCancel,
  onConfirm,
  children,
}: {
  title: string
  hint?: string
  disabled?: boolean
  onCancel(): void
  onConfirm(): void
  children?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-[var(--accent)] bg-surface-2 p-3">
      <p className="text-sm font-bold">{title}</p>
      {hint && <p className="mt-0.5 text-[11px] leading-snug text-ink-dim">{hint}</p>}
      <div className="mt-2 flex flex-col gap-2">{children}</div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-dim hover:bg-surface-3">
          Отмена
        </button>
        <button type="button" onClick={onConfirm} disabled={disabled} className={primaryButton}>
          Применить
        </button>
      </div>
    </div>
  )
}
