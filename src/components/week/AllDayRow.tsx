import { useMemo } from 'react'

import { blockStyle } from '../../lib/colors.ts'
import { tasksOnDate } from '../../lib/tasks.ts'
import { allDayRowCount, gridTemplate, layoutAllDay } from './grid.ts'
import type { Occurrence, Task } from '../../lib/types.ts'
import type { LocalDate } from '../../lib/datetime.ts'

interface Props {
  dates: LocalDate[]
  occurrences: Occurrence[]
  /** Dated tasks for these days; empty when the grid toggle is off. */
  tasks: Task[]
  selectedKey: string | null
  onSelect(occ: Occurrence): void
  onToggleTask(id: string): void
}

const BAR_HEIGHT = 22

/**
 * The strip above the hour grid.
 *
 * All-day items are drawn as continuous bars across the days they cover, not
 * as a separate chip per day: a three-day trip reads as one thing, and that is
 * the whole reason this row exists instead of putting them in the grid.
 */
export function AllDayRow({ dates, occurrences, tasks, selectedKey, onSelect, onToggleTask }: Props) {
  const bars = useMemo(() => layoutAllDay(occurrences, dates), [occurrences, dates])
  const barRows = allDayRowCount(bars)

  /** Dated tasks, bucketed by column. Tasks never span days. */
  const taskColumns = useMemo(() => {
    const byDate = new Map<LocalDate, Task[]>()
    for (const date of dates) byDate.set(date, tasksOnDate(tasks, date))
    return byDate
  }, [tasks, dates])

  const taskRows = Math.max(0, ...dates.map((d) => taskColumns.get(d)?.length ?? 0))
  const rows = barRows + taskRows

  if (rows === 0) {
    return <div className="h-2 shrink-0 border-b border-edge" />
  }

  return (
    <div
      className="grid shrink-0 items-start gap-y-0.5 border-b border-edge py-1"
      style={{
        gridTemplateColumns: gridTemplate(dates.length),
        gridTemplateRows: `repeat(${rows}, ${BAR_HEIGHT}px)`,
      }}
    >
      <div
        className="pr-1.5 text-right text-[10px] leading-[1.1] font-semibold text-ink-faint"
        style={{ gridRow: `1 / span ${rows}` }}
      >
        весь
        <br />
        день
      </div>

      {dates.flatMap((date, column) =>
        (taskColumns.get(date) ?? []).map((task, i) => (
          <button
            key={task.id}
            type="button"
            onClick={() => onToggleTask(task.id)}
            title={`${task.title} — отметить выполненной`}
            style={{ gridColumn: column + 2, gridRow: barRows + i + 1 }}
            className="mx-px flex items-center gap-1.5 overflow-hidden rounded-md border border-dashed border-edge-strong bg-surface-2 px-1.5 text-[11px] font-semibold text-ink-dim transition-colors hover:border-[var(--accent)] hover:text-ink"
          >
            <span aria-hidden className="shrink-0 text-[9px] opacity-70">
              ☐
            </span>
            <span className="truncate">{task.title}</span>
          </button>
        )),
      )}

      {bars.map((bar) => {
        const colors = blockStyle(bar.occ.color)
        return (
          <button
            key={bar.occ.key}
            type="button"
            onClick={() => onSelect(bar.occ)}
            style={{
              ...colors,
              // +2 because column 1 is the gutter and CSS grid lines are 1-based.
              gridColumn: `${bar.startIndex + 2} / ${bar.endIndex + 3}`,
              gridRow: bar.row + 1,
            }}
            title={bar.occ.title}
            className={[
              'mx-px flex items-center gap-1 truncate rounded-md px-2 text-[11px] font-semibold',
              'transition-transform duration-150 hover:-translate-y-px hover:shadow-md',
              bar.occ.key === selectedKey
                ? 'ring-2 ring-[var(--accent)] ring-offset-1 ring-offset-[var(--surface-1)]'
                : '',
            ].join(' ')}
          >
            {bar.occ.recurring && <span aria-hidden className="opacity-70">⟳</span>}
            <span className="truncate">{bar.occ.title || 'Без названия'}</span>
          </button>
        )
      })}
    </div>
  )
}
