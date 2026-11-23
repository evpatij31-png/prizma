import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'

import * as dt from '../../lib/datetime.ts'
import { durationMinutes, layoutDay, onDate, splitAllDay } from '../../lib/occurrences.ts'
import { blockStyle } from '../../lib/colors.ts'
import { useOccurrences } from '../../store/selectors.ts'
import { useStore } from '../../store/useStore.ts'
import { EventChip } from '../EventChip.tsx'
import { AllDayRow } from './AllDayRow.tsx'
import { GUTTER, HOUR_PX, gridHeight, gridTemplate, hourLabels, offsetOf } from './grid.ts'
import { useGridDrag, type DragPreview } from './useGridDrag.ts'
import type { LocalDate } from '../../lib/datetime.ts'

export function WeekView({ dates }: { dates: LocalDate[] }) {
  const occurrences = useOccurrences()
  const dayStartHour = useStore((s) => s.settings.dayStartHour)
  const dayEndHour = useStore((s) => s.settings.dayEndHour)
  const snapMinutes = useStore((s) => s.settings.snapMinutes)
  const defaultMinutes = useStore((s) => s.settings.defaultEventMinutes)
  const selectedKey = useStore((s) => s.selectedKey)
  const openOccurrence = useStore((s) => s.openOccurrence)
  const startNewEvent = useStore((s) => s.startNewEvent)
  const applyOccurrenceChange = useStore((s) => s.applyOccurrenceChange)
  const tasks = useStore((s) => s.tasks)
  const showTasksInGrid = useStore((s) => s.settings.showTasksInGrid)
  const toggleTaskDone = useStore((s) => s.toggleTaskDone)

  const gridTasks = useMemo(() => (showTasksInGrid ? tasks : []), [tasks, showTasksInGrid])

  const scroller = useRef<HTMLDivElement>(null)
  const height = gridHeight(dayStartHour, dayEndHour)
  const hours = useMemo(() => hourLabels(dayStartHour, dayEndHour), [dayStartHour, dayEndHour])

  const commit = useCallback(
    (p: DragPreview) => {
      if (p.kind === 'create' || !p.occ) {
        startNewEvent(p.start, p.end, false)
        return
      }
      void applyOccurrenceChange(p.occ, { start: p.start, end: p.end })
    },
    [startNewEvent, applyOccurrenceChange],
  )

  const drag = useGridDrag({
    dates,
    dayStartHour,
    dayEndHour,
    snapMinutes,
    defaultMinutes,
    onCommit: commit,
  })

  const perDay = useMemo(
    () =>
      dates.map((date) => {
        const { allDay, timed } = splitAllDay(onDate(occurrences, date))
        return { date, allDay, laid: layoutDay(timed, { date, dayStartHour, dayEndHour }) }
      }),
    [dates, occurrences, dayStartHour, dayEndHour],
  )

  const allDayOccurrences = useMemo(() => {
    const seen = new Set<string>()
    return perDay.flatMap((d) => d.allDay).filter((o) => !seen.has(o.key) && seen.add(o.key))
  }, [perDay])

  // Open on the current hour rather than at midnight, which is almost never
  // what the user wants to look at.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const target = offsetOf(dt.minutesOfDay(dt.now()), dayStartHour) - el.clientHeight / 3
    el.scrollTop = Math.max(0, Math.min(target, height - el.clientHeight))
  }, [dayStartHour, height])

  const span = Math.max(1, dayEndHour - dayStartHour) * 60
  const previewDate = drag.preview ? dt.dateOf(drag.preview.start) : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="grid shrink-0 border-b border-edge bg-surface-1/70 backdrop-blur"
        style={{ gridTemplateColumns: gridTemplate(dates.length) }}
      >
        <div />
        {dates.map((date) => (
          <DayHeading key={date} date={date} single={dates.length === 1} />
        ))}
      </div>

      <AllDayRow
        dates={dates}
        occurrences={allDayOccurrences}
        tasks={gridTasks}
        selectedKey={selectedKey}
        onSelect={openOccurrence}
        onToggleTask={(id) => void toggleTaskDone(id)}
      />

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <div
          ref={drag.gridRef}
          {...drag.handlers}
          className="relative grid touch-none select-none"
          style={{ gridTemplateColumns: gridTemplate(dates.length), height }}
        >
          <div className="relative" style={{ width: GUTTER }}>
            {hours.map(({ hour, label }) => (
              <div
                key={hour}
                className="absolute right-1.5 -translate-y-1/2 text-[10px] font-medium tabular-nums text-ink-faint"
                style={{ top: offsetOf(hour * 60, dayStartHour) }}
              >
                {hour === dayStartHour ? '' : label}
              </div>
            ))}
          </div>

          {perDay.map(({ date, laid }) => (
            <div
              key={date}
              data-date={date}
              onPointerDown={drag.beginCreate}
              className={clsx(
                'relative cursor-cell border-l border-grid',
                dt.isWeekend(date) && 'bg-surface-0/50',
                dt.isToday(date) && 'bg-[var(--accent-soft)]/25',
              )}
              style={{
                backgroundImage: `repeating-linear-gradient(to bottom, var(--grid-line) 0 1px, transparent 1px ${HOUR_PX}px)`,
              }}
            >
              {laid.map((l) => {
                const beingDragged = drag.preview?.occ?.key === l.occ.key
                return (
                  <div
                    key={l.occ.key}
                    className={clsx('absolute p-px', beingDragged ? 'opacity-25' : 'animate-rise')}
                    style={{
                      top: `${l.top * 100}%`,
                      height: `${l.height * 100}%`,
                      left: `${l.left * 100}%`,
                      width: `${l.width * 100}%`,
                      // Already a small bounded number — see MAX_LAYOUT_Z.
                      zIndex: 1 + l.z,
                    }}
                    onPointerDown={(e) => {
                      if (l.occ.readOnly) return
                      e.stopPropagation()
                      drag.beginMove(e, l.occ)
                    }}
                  >
                    <div className="relative h-full cursor-grab active:cursor-grabbing">
                      <EventChip
                        occ={l.occ}
                        variant="block"
                        selected={l.occ.key === selectedKey}
                        onSelect={(o) => {
                          if (drag.justDragged.current) return
                          openOccurrence(o)
                        }}
                      />
                      {!l.occ.readOnly && (
                        <>
                          <ResizeHandle edge="start" onPointerDown={(e) => drag.beginResize(e, l.occ, 'start')} />
                          <ResizeHandle edge="end" onPointerDown={(e) => drag.beginResize(e, l.occ, 'end')} />
                        </>
                      )}
                    </div>
                  </div>
                )
              })}

              {drag.preview && previewDate === date && (
                <PreviewBlock preview={drag.preview} dayStartHour={dayStartHour} span={span} />
              )}

              {dt.isToday(date) && <NowLine dayStartHour={dayStartHour} dayEndHour={dayEndHour} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ResizeHandle({
  edge,
  onPointerDown,
}: {
  edge: 'start' | 'end'
  onPointerDown(e: React.PointerEvent): void
}) {
  return (
    <div
      role="presentation"
      onPointerDown={(e) => {
        e.stopPropagation()
        onPointerDown(e)
      }}
      className={clsx(
        'absolute inset-x-0 z-10 h-2 cursor-ns-resize',
        edge === 'start' ? '-top-0.5' : '-bottom-0.5',
      )}
    />
  )
}

/** The translucent block that follows the pointer during a drag. */
function PreviewBlock({
  preview,
  dayStartHour,
  span,
}: {
  preview: DragPreview
  dayStartHour: number
  span: number
}) {
  const startMinutes = dt.minutesOfDay(preview.start)
  const minutes = Math.max(5, dt.diffMinutes(preview.start, preview.end))
  const colors = blockStyle(preview.occ?.color ?? 'violet')

  return (
    <div
      className="pointer-events-none absolute z-30 overflow-hidden rounded-lg px-2 py-1 text-xs font-bold shadow-lg ring-2 ring-[var(--accent)]"
      style={{
        ...colors,
        top: `${((startMinutes - dayStartHour * 60) / span) * 100}%`,
        height: `${(minutes / span) * 100}%`,
        left: 0,
        right: 0,
        opacity: 0.92,
      }}
    >
      <div className="tabular-nums">
        {dt.formatTime(preview.start)} – {dt.formatTime(preview.end)}
      </div>
      <div className="text-[10px] font-semibold opacity-80">{dt.formatDuration(minutes)}</div>
    </div>
  )
}

function DayHeading({ date, single }: { date: LocalDate; single: boolean }) {
  const today = dt.isToday(date)
  const setCursor = useStore((s) => s.setCursor)
  const setView = useStore((s) => s.setView)

  return (
    <button
      type="button"
      onClick={() => {
        void setCursor(date)
        if (!single) void setView('day')
      }}
      className="flex flex-col items-center gap-0.5 py-2 transition-colors hover:bg-surface-2"
    >
      <span className="text-[10px] font-semibold tracking-wide text-ink-faint uppercase">
        {dt.formatWeekdayShort(date)}
      </span>
      <span
        className={clsx(
          'grid size-7 place-items-center rounded-full text-sm font-bold tabular-nums',
          today ? 'bg-[var(--today)] text-[var(--accent-text)]' : 'text-ink',
        )}
      >
        {dt.parse(date).d}
      </span>
    </button>
  )
}

/** The red line at the current time, ticking once a minute. */
function NowLine({ dayStartHour, dayEndHour }: { dayStartHour: number; dayEndHour: number }) {
  const [minutes, setMinutes] = useState(() => dt.minutesOfDay(dt.now()))

  useEffect(() => {
    const id = setInterval(() => setMinutes(dt.minutesOfDay(dt.now())), 60_000)
    return () => clearInterval(id)
  }, [])

  if (minutes < dayStartHour * 60 || minutes > dayEndHour * 60) return null

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-[var(--now-line)]"
      style={{ top: offsetOf(minutes, dayStartHour) }}
    >
      <span className="absolute -top-1 -left-1 size-2 rounded-full bg-[var(--now-line)]" />
    </div>
  )
}

export { durationMinutes }
