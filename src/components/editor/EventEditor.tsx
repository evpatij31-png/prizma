import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'

import * as dt from '../../lib/datetime.ts'
import { swatch } from '../../lib/colors.ts'
import { useStore, type EditorTarget } from '../../store/useStore.ts'
import { durationMinutes } from '../../lib/occurrences.ts'
import { RecurrenceField } from './RecurrenceField.tsx'
import type { CalEvent } from '../../lib/types.ts'

/**
 * The event panel: a sheet at the bottom on a phone, a column on the right on
 * a wide screen. Never a modal dialog — the calendar behind it stays visible,
 * which is what lets you check a neighbouring day while you type.
 *
 * Edits are held locally and committed on save, rather than written through on
 * every keystroke: a half-typed title should not reach the grid, and Cancel
 * has to mean something.
 */
export function EventEditor() {
  const editor = useStore((s) => s.editor)
  const calendars = useStore((s) => s.calendars)
  const events = useStore((s) => s.events)
  const saveEvent = useStore((s) => s.saveEvent)
  const deleteEvent = useStore((s) => s.deleteEvent)
  const openEditor = useStore((s) => s.openEditor)
  const applyOccurrenceChange = useStore((s) => s.applyOccurrenceChange)
  const deleteOccurrence = useStore((s) => s.deleteOccurrence)

  const [draft, setDraft] = useState<CalEvent | null>(null)
  const [openedFor, setOpenedFor] = useState<EditorTarget | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  /**
   * The local copy is taken during render, not in an effect.
   *
   * With an effect it lagged one render behind: on the commit where the
   * editor opens, `draft` was still null, the component returned null, and
   * the focus effect below fired at an input that did not exist yet. By the
   * time it did, `editor` had not changed, so the effect never ran again and
   * a new event opened with nothing focused.
   */
  if (editor !== openedFor) {
    setOpenedFor(editor)
    setDraft(editor ? { ...editor.event } : null)
    setConfirmDelete(false)
  }

  useEffect(() => {
    if (editor?.isNew) titleRef.current?.focus()
  }, [editor])

  useEffect(() => {
    if (!editor) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        openEditor(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editor, openEditor])

  if (!editor || !draft) return null

  const calendar = calendars.find((c) => c.id === draft.calendarId)
  const readOnly = calendar?.readOnly === true || draft.readOnly === true
  const invalid = !draft.allDay && draft.end <= draft.start
  const patch = (changes: Partial<CalEvent>) => setDraft({ ...draft, ...changes })

  /** Moving the start drags the end with it, keeping the length. */
  const moveStart = (nextStart: string) => {
    const minutes = durationMinutes(draft)
    const end = draft.allDay
      ? dt.dateOf(dt.addDays(nextStart, Math.max(1, Math.round(minutes / 1440))))
      : dt.addMinutes(nextStart, minutes)
    patch({ start: nextStart, end })
  }

  const toggleAllDay = (allDay: boolean) => {
    if (allDay) {
      patch({ allDay, start: dt.dateOf(draft.start), end: dt.dateOf(dt.addDays(draft.start, 1)) })
    } else {
      const start = `${dt.dateOf(draft.start)}T09:00`
      patch({ allDay, start, end: dt.addMinutes(start, 60) })
    }
  }

  /**
   * A single event is written straight out. An instance of a series goes
   * through the scope question instead — except a change to the rule itself,
   * which only ever means the whole series.
   */
  const save = async () => {
    if (invalid) return
    const next = { ...draft, title: draft.title.trim() }
    const series = events.find((e) => e.id === draft.id)
    const ruleChanged = series ? (series.rrule ?? '') !== (next.rrule ?? '') : false

    if (editor.occurrenceStart && series?.rrule && !ruleChanged) {
      await applyOccurrenceChange(
        { eventId: draft.id, start: editor.occurrenceStart, title: next.title },
        {
          start: next.start,
          end: next.end,
          title: next.title,
          description: next.description,
          location: next.location,
          allDay: next.allDay,
          calendarId: next.calendarId,
        },
      )
      return
    }

    // Changing the rule re-anchors the series on the instance being edited,
    // which is what "make this repeat weekly from here" should do.
    const saved = await saveEvent(next)
    if (saved) openEditor(null)
  }

  const remove = async () => {
    if (editor.occurrenceStart && draft.rrule) {
      await deleteOccurrence({ eventId: draft.id, start: editor.occurrenceStart, title: draft.title })
      return
    }
    await deleteEvent(draft.id)
  }

  return (
    <>
      <button
        type="button"
        aria-label="Закрыть редактор"
        onClick={() => openEditor(null)}
        className="fixed inset-0 z-30 bg-black/40 lg:hidden"
      />
      <aside
        role="dialog"
        aria-label={editor.isNew ? 'Новое событие' : 'Событие'}
        className={clsx(
          'z-40 flex flex-col border-edge bg-surface-1 shadow-[var(--shadow-panel)]',
          'fixed inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl border-t pad-safe-b',
          'lg:static lg:max-h-none lg:w-80 lg:shrink-0 lg:rounded-none lg:border-t-0 lg:border-l',
        )}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-edge px-4 py-3">
          <span
            aria-hidden
            className="size-3 shrink-0 rounded-full"
            style={{ background: swatch(calendar?.color).dot }}
          />
          <h2 className="min-w-0 flex-1 truncate text-sm font-bold">
            {editor.isNew ? 'Новое событие' : 'Событие'}
          </h2>
          <button
            type="button"
            onClick={() => openEditor(null)}
            aria-label="Закрыть"
            className="grid size-7 shrink-0 place-items-center rounded-lg text-ink-dim hover:bg-surface-2 hover:text-ink"
          >
            ✕
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto scroll-thin p-4">
          {readOnly && (
            <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-dim">
              Событие из подписки — его можно только читать. Изменения всё равно затёрло бы
              следующее обновление ленты.
            </p>
          )}

          <Field label="Название">
            <input
              ref={titleRef}
              value={draft.title}
              disabled={readOnly}
              onChange={(e) => patch({ title: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save()
              }}
              placeholder="Без названия"
              className={inputClass}
            />
          </Field>

          <Field label="Календарь">
            <select
              value={draft.calendarId}
              disabled={readOnly}
              onChange={(e) => patch({ calendarId: e.target.value })}
              className={inputClass}
            >
              {calendars.map((c) => (
                <option key={c.id} value={c.id} disabled={c.readOnly}>
                  {c.name}
                  {c.readOnly ? ' (только чтение)' : ''}
                </option>
              ))}
            </select>
          </Field>

          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={draft.allDay}
              disabled={readOnly}
              onChange={(e) => toggleAllDay(e.target.checked)}
              className="size-4 rounded accent-[var(--accent)]"
            />
            <span className="font-medium">Весь день</span>
          </label>

          <Field label="Начало">
            <DateTimeInput
              value={draft.start}
              allDay={draft.allDay}
              disabled={readOnly}
              onChange={moveStart}
            />
          </Field>

          <Field label={draft.allDay ? 'Конец (включительно)' : 'Конец'}>
            <DateTimeInput
              // All-day end is exclusive in storage but inclusive to a human,
              // so it is shifted a day in both directions here.
              value={draft.allDay ? dt.dateOf(dt.addDays(draft.end, -1)) : draft.end}
              allDay={draft.allDay}
              disabled={readOnly}
              onChange={(v) => patch({ end: draft.allDay ? dt.dateOf(dt.addDays(v, 1)) : v })}
            />
            {invalid && (
              <p className="mt-1 text-xs text-[var(--now-line)]">Конец должен быть позже начала</p>
            )}
            {!invalid && !draft.allDay && (
              <p className="mt-1 text-xs text-ink-faint">
                {dt.formatDuration(durationMinutes(draft))}
              </p>
            )}
          </Field>

          <RecurrenceField
            value={draft.rrule}
            start={draft.start}
            disabled={readOnly}
            onChange={(rrule) => patch({ rrule })}
          />

          {editor.occurrenceStart && draft.rrule && (
            <p className="-mt-2 text-xs text-ink-faint">
              Это одно вхождение серии. При сохранении спросим, к чему применить изменения.
            </p>
          )}

          <Field label="Место">
            <input
              value={draft.location ?? ''}
              disabled={readOnly}
              onChange={(e) => patch({ location: e.target.value || undefined })}
              placeholder="Не указано"
              className={inputClass}
            />
          </Field>

          <Field label="Описание">
            <textarea
              value={draft.description ?? ''}
              disabled={readOnly}
              onChange={(e) => patch({ description: e.target.value || undefined })}
              rows={3}
              placeholder="Пусто"
              className={clsx(inputClass, 'resize-y')}
            />
          </Field>
        </div>

        {!readOnly && (
          <footer className="flex shrink-0 items-center gap-2 border-t border-edge p-3">
            {!editor.isNew &&
              (confirmDelete ? (
                <button
                  type="button"
                  onClick={() => void remove()}
                  className="rounded-lg bg-[var(--now-line)] px-3 py-2 text-xs font-bold text-white"
                >
                  Точно удалить
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="rounded-lg px-3 py-2 text-xs font-semibold text-[var(--now-line)] hover:bg-surface-2"
                >
                  Удалить
                </button>
              ))}
            <button
              type="button"
              onClick={() => openEditor(null)}
              className="ml-auto rounded-lg px-3 py-2 text-sm font-semibold text-ink-dim hover:bg-surface-2"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={invalid}
              className={clsx(
                'rounded-lg px-4 py-2 text-sm font-bold transition-colors',
                invalid
                  ? 'cursor-not-allowed bg-surface-3 text-ink-faint'
                  : 'bg-[var(--accent)] text-[var(--accent-text)]',
              )}
            >
              Сохранить
            </button>
          </footer>
        )}
      </aside>
    </>
  )
}

const inputClass =
  'w-full rounded-lg border border-edge bg-surface-2 px-2.5 py-2 text-sm outline-none ' +
  'transition-colors focus:border-[var(--accent)] disabled:opacity-60'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-bold tracking-wide text-ink-faint uppercase">
        {label}
      </span>
      {children}
    </label>
  )
}

/** Native date and time inputs: accessible, localised, and keyboard-friendly. */
function DateTimeInput({
  value,
  allDay,
  disabled,
  onChange,
}: {
  value: string
  allDay: boolean
  disabled: boolean
  onChange(next: string): void
}) {
  const date = dt.dateOf(value)
  const time = dt.timeOf(value) || '09:00'

  return (
    <div className="flex gap-2">
      <input
        type="date"
        value={date}
        disabled={disabled}
        onChange={(e) => {
          if (!e.target.value) return
          onChange(allDay ? e.target.value : `${e.target.value}T${time}`)
        }}
        className={clsx(inputClass, 'flex-1')}
      />
      {!allDay && (
        <input
          type="time"
          value={time}
          disabled={disabled}
          step={300}
          onChange={(e) => {
            if (!e.target.value) return
            onChange(`${date}T${e.target.value.slice(0, 5)}`)
          }}
          className={clsx(inputClass, 'w-28')}
        />
      )}
    </div>
  )
}
