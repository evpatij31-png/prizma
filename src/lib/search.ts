/**
 * Searching what is loaded.
 *
 * Scope is deliberately the loaded window, not the whole database: a full
 * index is V2, and promising more than that would mean silently missing
 * results. The UI says what was searched so the limit is visible rather than
 * discovered.
 */

import * as dt from './datetime.ts'
import type { Occurrence, Task } from './types.ts'

/** Case- and diacritic-insensitive, and Russian ё reads as е. */
export function normalise(text: string): string {
  return text
    .toLocaleLowerCase('ru')
    .replace(/ё/g, 'е')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

/** Every term must appear somewhere, in any order. */
export function matches(haystack: string[], query: string): boolean {
  const terms = normalise(query).split(/\s+/).filter(Boolean)
  if (!terms.length) return false
  const blob = haystack.filter(Boolean).map(normalise).join(' ')
  return terms.every((term) => blob.includes(term))
}

export interface SearchHit {
  kind: 'event' | 'task'
  key: string
  title: string
  /** Where it sits in time, for the result line. */
  when: string
  /** The date to jump to. */
  date: string
  occurrence?: Occurrence
  task?: Task
}

export function searchOccurrences(occurrences: Occurrence[], query: string): Occurrence[] {
  if (!query.trim()) return []
  return occurrences.filter((o) => matches([o.title, o.description ?? '', o.location ?? ''], query))
}

export function searchTasks(tasks: Task[], query: string): Task[] {
  if (!query.trim()) return []
  return tasks.filter((t) => t.deletedAt == null && matches([t.title, t.notes ?? ''], query))
}

/** Events and tasks together, nearest first, capped so the list stays usable. */
export function search(occurrences: Occurrence[], tasks: Task[], query: string, limit = 50): SearchHit[] {
  const hits: SearchHit[] = []

  for (const occ of searchOccurrences(occurrences, query)) {
    hits.push({
      kind: 'event',
      key: occ.key,
      title: occ.title || 'Без названия',
      // The day is part of the line, not just the time: a weekly meeting
      // otherwise produces a column of identical "10:00 – 10:30" rows with
      // no way to tell which Monday is which.
      when: occ.allDay
        ? dt.formatRange(occ.start, occ.end, true)
        : `${dt.formatRelativeDay(occ.start)}, ${dt.formatTime(occ.start)} – ${dt.formatTime(occ.end)}`,
      date: dt.dateOf(occ.start),
      occurrence: occ,
    })
  }

  for (const task of searchTasks(tasks, query)) {
    hits.push({
      kind: 'task',
      key: `task:${task.id}`,
      title: task.title,
      when: task.due ? dt.formatRelativeDay(task.due) : 'Без срока',
      date: task.due ? dt.dateOf(task.due) : dt.today(),
      task,
    })
  }

  // Nearest to today first: a search is almost always about something soon.
  const today = dt.today()
  hits.sort((a, b) => {
    const da = Math.abs(dt.diffDays(today, a.date))
    const db = Math.abs(dt.diffDays(today, b.date))
    return da - db || a.title.localeCompare(b.title, dt.getLocale())
  })

  return hits.slice(0, limit)
}
