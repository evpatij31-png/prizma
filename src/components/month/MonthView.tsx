import { Fragment, useState } from 'react'
import clsx from 'clsx'

import * as dt from '../../lib/datetime.ts'
import { useMonthGrid } from '../../store/selectors.ts'
import { useStore } from '../../store/useStore.ts'
import { inCursorMonth, weekNumber } from '../../lib/view.ts'
import { tasksOnDate } from '../../lib/tasks.ts'
import { EventChip } from '../EventChip.tsx'
import type { Occurrence, Task } from '../../lib/types.ts'
import type { LocalDate } from '../../lib/datetime.ts'

/** Chips that fit in a month cell before it collapses into "+N". */
const MAX_CHIPS = 3

export function MonthView() {
  const { dates, byDate } = useMonthGrid()
  const cursor = useStore((s) => s.cursor)
  const weekStart = useStore((s) => s.settings.weekStart)
  const showWeekNumbers = useStore((s) => s.settings.showWeekNumbers)
  const selectedKey = useStore((s) => s.selectedKey)
  const openOccurrence = useStore((s) => s.openOccurrence)
  const setCursor = useStore((s) => s.setCursor)
  const setView = useStore((s) => s.setView)
  const allTasks = useStore((s) => s.tasks)
  const showTasksInGrid = useStore((s) => s.settings.showTasksInGrid)
  const toggleTaskDone = useStore((s) => s.toggleTaskDone)

  /** Which cell is showing its full list, when it has more than fits. */
  const [expanded, setExpanded] = useState<LocalDate | null>(null)

  const headers = dt.weekdayHeaders(weekStart)

  const openDay = (date: LocalDate) => {
    void setCursor(date)
    void setView('day')
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="grid shrink-0 border-b border-edge text-[11px] font-semibold tracking-wide text-ink-faint uppercase"
        style={{ gridTemplateColumns: columns(showWeekNumbers) }}
      >
        {showWeekNumbers && <div className="px-2 py-2 text-center">нед</div>}
        {headers.map((label, i) => (
          <div
            key={label + i}
            className={clsx('px-2 py-2 text-center', isWeekendColumn(i, weekStart) && 'text-[var(--accent)]')}
          >
            {label}
          </div>
        ))}
      </div>

      <div
        className="grid min-h-0 flex-1 grid-rows-6"
        style={{ gridTemplateColumns: columns(showWeekNumbers) }}
      >
        {dates.map((date, index) => {
          const isRowStart = index % 7 === 0
          const occurrences = byDate.get(date) ?? []
          return (
            <Fragment key={date}>
              {showWeekNumbers && isRowStart && (
                <div className="flex items-start justify-center border-t border-grid pt-1.5 text-[10px] tabular-nums text-ink-faint">
                  {weekNumber(date)}
                </div>
              )}
              <MonthCell
                date={date}
                occurrences={occurrences}
                dimmed={!inCursorMonth(date, cursor)}
                tasks={showTasksInGrid ? tasksOnDate(allTasks, date) : []}
                onToggleTask={(id) => void toggleTaskDone(id)}
                selectedKey={selectedKey}
                expanded={expanded === date}
                onExpand={() => setExpanded(expanded === date ? null : date)}
                onSelect={openOccurrence}
                onOpenDay={() => openDay(date)}
              />
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

function columns(showWeekNumbers: boolean): string {
  return showWeekNumbers ? '2.5rem repeat(7, minmax(0, 1fr))' : 'repeat(7, minmax(0, 1fr))'
}

function isWeekendColumn(index: number, weekStart: 0 | 1): boolean {
  const weekday = (index + weekStart) % 7
  return weekday === 0 || weekday === 6
}

interface CellProps {
  date: LocalDate
  occurrences: Occurrence[]
  tasks: Task[]
  onToggleTask(id: string): void
  dimmed: boolean
  selectedKey: string | null
  expanded: boolean
  onExpand(): void
  onSelect(occ: Occurrence): void
  onOpenDay(): void
}

function MonthCell({
  date,
  occurrences,
  tasks,
  onToggleTask,
  dimmed,
  selectedKey,
  expanded,
  onExpand,
  onSelect,
  onOpenDay,
}: CellProps) {
  const today = dt.isToday(date)
  const visible = expanded ? occurrences : occurrences.slice(0, MAX_CHIPS)
  const hidden = occurrences.length - visible.length

  return (
    <div
      className={clsx(
        'flex min-h-0 min-w-0 flex-col gap-0.5 border-t border-l border-grid p-1 first:border-l-0',
        'transition-colors hover:bg-surface-2/60',
        dimmed && 'bg-surface-0/40 text-ink-faint',
      )}
    >
      <button
        type="button"
        onClick={onOpenDay}
        className="flex shrink-0 items-center gap-1 self-start rounded-md px-1 text-xs font-semibold hover:bg-surface-3"
        aria-label={`Открыть ${dt.formatDate(date)}`}
      >
        <span
          className={clsx(
            'grid size-6 place-items-center rounded-full tabular-nums',
            today && 'bg-[var(--today)] font-bold text-[var(--accent-text)]',
            !today && dimmed && 'text-ink-faint',
            !today && !dimmed && 'text-ink',
          )}
        >
          {dt.parse(date).d}
        </span>
      </button>

      <div className="flex min-h-0 flex-col gap-0.5 overflow-hidden">
        {visible.map((occ) => (
          <div key={occ.key} className="animate-rise">
            <EventChip occ={occ} selected={occ.key === selectedKey} onSelect={onSelect} />
          </div>
        ))}
        {tasks.map((task) => (
          <button
            key={task.id}
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onToggleTask(task.id)
            }}
            title={`${task.title} — отметить выполненной`}
            className="flex items-center gap-1 overflow-hidden rounded-md border border-dashed border-edge-strong px-1.5 py-0.5 text-left text-[11px] font-semibold text-ink-dim transition-colors hover:border-[var(--accent)] hover:text-ink"
          >
            <span aria-hidden className="shrink-0 text-[9px] opacity-70">
              ☐
            </span>
            <span className="truncate">{task.title}</span>
          </button>
        ))}
      </div>

      {hidden > 0 && (
        <button
          type="button"
          onClick={onExpand}
          className="shrink-0 self-start rounded px-1 text-[11px] font-semibold text-ink-dim hover:bg-surface-3 hover:text-ink"
        >
          +{hidden}
        </button>
      )}
      {expanded && occurrences.length > MAX_CHIPS && (
        <button
          type="button"
          onClick={onExpand}
          className="shrink-0 self-start rounded px-1 text-[11px] text-ink-faint hover:bg-surface-3"
        >
          свернуть
        </button>
      )}
    </div>
  )
}
