import { useMemo, useState } from 'react'
import clsx from 'clsx'

import * as dt from '../../lib/datetime.ts'
import { GROUP_LABELS, PRIORITY_LABELS, countOpen, describeDue, groupTasks, orderBetween, type TaskGroup } from '../../lib/tasks.ts'
import { useStore } from '../../store/useStore.ts'
import type { Priority, Task } from '../../lib/types.ts'

const VISIBLE_GROUPS: TaskGroup[] = ['overdue', 'today', 'upcoming', 'someday', 'done']

export function TaskPanel() {
  const tasks = useStore((s) => s.tasks)
  const calendars = useStore((s) => s.calendars)
  const cursor = useStore((s) => s.cursor)
  const showCompleted = useStore((s) => s.settings.showCompletedTasks)
  const saveTask = useStore((s) => s.saveTask)
  const [title, setTitle] = useState('')

  const live = useMemo(() => tasks.filter((t) => t.deletedAt == null), [tasks])
  const grouped = useMemo(() => groupTasks(live), [live])
  const open = countOpen(live)

  const add = async () => {
    const trimmed = title.trim()
    if (!trimmed) return
    const calendarId = calendars.find((c) => !c.readOnly)?.id ?? calendars[0]?.id
    if (!calendarId) return
    const lowest = live.reduce((min, t) => Math.min(min, t.order), Number.POSITIVE_INFINITY)
    setTitle('')
    await saveTask({
      id: '',
      uid: '',
      updatedAt: 0,
      calendarId,
      title: trimmed,
      // New tasks go to the top of the undated group, where they are seen.
      order: orderBetween(undefined, Number.isFinite(lowest) ? lowest : undefined),
      done: false,
      priority: 0,
      reminders: [],
      // Added while looking at a day: assume that day is the deadline.
      due: dt.dateOf(cursor) === dt.today() ? undefined : dt.dateOf(cursor),
    })
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <h2 className="flex items-baseline gap-2 px-1 pb-2 text-[11px] font-bold tracking-wider text-ink-faint uppercase">
        Задачи
        {open > 0 && <span className="text-[10px] font-semibold text-[var(--accent)]">{open}</span>}
      </h2>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void add()
          if (e.key === 'Escape') setTitle('')
        }}
        placeholder="Новая задача…"
        aria-label="Новая задача"
        className="mb-2 w-full rounded-lg border border-edge bg-surface-2 px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-[var(--accent)]"
      />

      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        {live.length === 0 && (
          <p className="px-1 py-2 text-xs text-ink-faint">Пока пусто. Введите задачу выше.</p>
        )}

        {VISIBLE_GROUPS.map((group) => {
          const items = grouped.get(group)
          if (!items?.length) return null
          if (group === 'done' && !showCompleted) return null
          return (
            <div key={group} className="mb-2">
              <h3
                className={clsx(
                  'px-1 pb-1 text-[10px] font-bold tracking-wide uppercase',
                  group === 'overdue' ? 'text-[var(--now-line)]' : 'text-ink-faint',
                )}
              >
                {GROUP_LABELS[group]}
              </h3>
              <ul className="flex flex-col gap-px">
                {items.map((task) => (
                  <TaskRow key={task.id} task={task} overdue={group === 'overdue'} />
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function TaskRow({ task, overdue }: { task: Task; overdue: boolean }) {
  const toggleTaskDone = useStore((s) => s.toggleTaskDone)
  const saveTask = useStore((s) => s.saveTask)
  const deleteTask = useStore((s) => s.deleteTask)
  const [expanded, setExpanded] = useState(false)

  const due = describeDue(task)

  return (
    <li className="rounded-lg transition-colors hover:bg-surface-2">
      <div className="flex items-start gap-2 px-1.5 py-1.5">
        <input
          type="checkbox"
          checked={task.done}
          onChange={() => void toggleTaskDone(task.id)}
          aria-label={task.done ? `Вернуть «${task.title}»` : `Выполнить «${task.title}»`}
          className="mt-0.5 size-4 shrink-0 cursor-pointer rounded accent-[var(--accent)]"
        />
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="min-w-0 flex-1 text-left"
          aria-expanded={expanded}
        >
          <span
            className={clsx(
              'block truncate text-sm transition-all',
              task.done ? 'text-ink-faint line-through decoration-ink-faint' : 'text-ink',
            )}
          >
            {task.title}
          </span>
          {due && (
            <span className={clsx('block text-[11px]', overdue ? 'text-[var(--now-line)]' : 'text-ink-faint')}>
              {due}
            </span>
          )}
        </button>
        {task.priority > 0 && !expanded && (
          <span
            aria-label={`Приоритет: ${PRIORITY_LABELS[task.priority]}`}
            title={PRIORITY_LABELS[task.priority]}
            className="mt-0.5 shrink-0 text-[10px] font-bold text-[var(--accent)]"
          >
            {'!'.repeat(task.priority)}
          </span>
        )}
      </div>

      {expanded && (
        <div className="flex flex-wrap items-center gap-1.5 px-1.5 pb-2">
          <input
            type="date"
            value={task.due ? dt.dateOf(task.due) : ''}
            onChange={(e) => void saveTask({ ...task, due: e.target.value || undefined })}
            aria-label="Срок"
            className="rounded-md border border-edge bg-surface-2 px-1.5 py-1 text-xs outline-none focus:border-[var(--accent)]"
          />
          <select
            value={task.priority}
            onChange={(e) => void saveTask({ ...task, priority: Number(e.target.value) as Priority })}
            aria-label="Приоритет"
            className="rounded-md border border-edge bg-surface-2 px-1.5 py-1 text-xs outline-none focus:border-[var(--accent)]"
          >
            {([0, 1, 2, 3] as Priority[]).map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void deleteTask(task.id)}
            className="ml-auto rounded-md px-1.5 py-1 text-xs font-semibold text-[var(--now-line)] hover:bg-surface-3"
          >
            Удалить
          </button>
        </div>
      )}
    </li>
  )
}
