/**
 * Tasks: things to do, as opposed to things that take time.
 *
 * Kept a separate entity from events on purpose. A task has a done state, a
 * priority and no duration, and it does not disappear when its deadline
 * passes — modelling it as a zero-length event would break recurrence, ICS
 * export and the day layout all at once.
 */

import * as dt from './datetime.ts'
import type { Local, LocalDate } from './datetime.ts'
import type { Priority, Task } from './types.ts'

export type TaskGroup = 'overdue' | 'today' | 'upcoming' | 'someday' | 'done'

export const GROUP_LABELS: Record<TaskGroup, string> = {
  overdue: 'Просрочено',
  today: 'Сегодня',
  upcoming: 'Дальше',
  someday: 'Без срока',
  done: 'Выполнено',
}

/** Sort rank of each group; lower comes first. */
const GROUP_RANK: Record<TaskGroup, number> = {
  overdue: 0,
  today: 1,
  upcoming: 2,
  someday: 3,
  done: 4,
}

export const PRIORITY_LABELS: Record<Priority, string> = {
  0: 'Обычный',
  1: 'Низкий',
  2: 'Средний',
  3: 'Высокий',
}

/**
 * Overdue is computed, never stored. A stored flag would need a timer to stay
 * true and would be wrong every time the app was closed over midnight.
 */
export function isOverdue(task: Task, now: Local = dt.now()): boolean {
  if (task.done || !task.due) return false
  // A date-only deadline is not missed until the day is over.
  return dt.hasTime(task.due) ? task.due < now : task.due < dt.dateOf(now)
}

export function groupOf(task: Task, now: Local = dt.now()): TaskGroup {
  if (task.done) return 'done'
  if (!task.due) return 'someday'
  if (isOverdue(task, now)) return 'overdue'
  return dt.dateOf(task.due) === dt.dateOf(now) ? 'today' : 'upcoming'
}

/**
 * Panel order: overdue, then today, then the rest by deadline, then the
 * undated ones. Ties break by priority, then by the manual order.
 */
export function sortTasks(tasks: Task[], now: Local = dt.now()): Task[] {
  return tasks.slice().sort((a, b) => {
    const rank = GROUP_RANK[groupOf(a, now)] - GROUP_RANK[groupOf(b, now)]
    if (rank !== 0) return rank

    if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1
    if (a.priority !== b.priority) return b.priority - a.priority
    if (a.order !== b.order) return a.order - b.order
    return a.title.localeCompare(b.title, dt.getLocale())
  })
}

export function groupTasks(tasks: Task[], now: Local = dt.now()): Map<TaskGroup, Task[]> {
  const out = new Map<TaskGroup, Task[]>()
  for (const task of sortTasks(tasks, now)) {
    const group = groupOf(task, now)
    const bucket = out.get(group)
    if (bucket) bucket.push(task)
    else out.set(group, [task])
  }
  return out
}

/** Live tasks with a deadline on this day, for the all-day row. */
export function tasksOnDate(tasks: Task[], date: LocalDate): Task[] {
  return tasks.filter((t) => t.deletedAt == null && !t.done && t.due && dt.dateOf(t.due) === date)
}

/**
 * A fractional order, so inserting between two neighbours rewrites one record
 * rather than renumbering the whole list — which on IndexedDB would be a
 * hundred writes for one drag.
 */
export function orderBetween(before?: number, after?: number): number {
  if (before != null && after != null) return (before + after) / 2
  if (before != null) return before + 1
  if (after != null) return after - 1
  return 1
}

/** The order a task needs to land at `index` in `list`. */
export function orderForIndex(list: Task[], index: number): number {
  const before = index > 0 ? list[index - 1]?.order : undefined
  const after = list[index]?.order
  return orderBetween(before, after)
}

/**
 * A short human deadline: "сегодня", "завтра, 18:00", "3 дек.".
 * Relative to the real today, which is what the reader compares against.
 */
export function describeDue(task: Task): string | null {
  if (!task.due) return null
  const day = dt.formatRelativeDay(task.due)
  if (!dt.hasTime(task.due)) return day
  return `${day}, ${dt.formatTime(task.due)}`
}

export function countOpen(tasks: Task[]): number {
  return tasks.filter((t) => t.deletedAt == null && !t.done).length
}
