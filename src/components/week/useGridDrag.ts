import { useCallback, useRef, useState } from 'react'

import { applyDrag, isDrag, type DragKind, type DragOrigin, type DragResult } from '../../lib/drag.ts'
import * as dt from '../../lib/datetime.ts'
import { HOUR_PX, minutesAt } from './grid.ts'
import type { Occurrence } from '../../lib/types.ts'
import type { LocalDate } from '../../lib/datetime.ts'

/**
 * Pointer plumbing for the hour grid.
 *
 * One code path for mouse and touch: Pointer Events plus `setPointerCapture`,
 * so a drag keeps following the finger even when it leaves the element. The
 * arithmetic lives in `lib/drag.ts`; this file only turns screen coordinates
 * into `{ date, minutes }` and decides when a press became a drag.
 */

export interface DragPreview {
  kind: DragKind
  occ: Occurrence | null
  start: string
  end: string
}

interface Options {
  dates: LocalDate[]
  dayStartHour: number
  dayEndHour: number
  snapMinutes: number
  defaultMinutes: number
  /** Called once, on release, with the final times. */
  onCommit(preview: DragPreview): void
}

export function useGridDrag({ dates, dayStartHour, dayEndHour, snapMinutes, defaultMinutes, onCommit }: Options) {
  const gridRef = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<DragPreview | null>(null)

  /** True between a drag ending and the synthetic click that follows it. */
  const justDragged = useRef(false)
  const session = useRef<{
    origin: DragOrigin
    from: { x: number; y: number }
    moved: boolean
    occ: Occurrence | null
    pointerId: number
    target: HTMLElement
  } | null>(null)

  /**
   * Screen point to grid position.
   *
   * The column is found by arithmetic on the container rect rather than
   * `elementFromPoint`, because the preview block sits under the cursor during
   * a drag and would otherwise be what the browser reports hitting.
   */
  const locate = useCallback(
    (clientX: number, clientY: number) => {
      const grid = gridRef.current
      if (!grid || !dates.length) return null
      const rect = grid.getBoundingClientRect()
      const gutter = (grid.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0
      const columnWidth = (rect.width - gutter) / dates.length
      const rawIndex = Math.floor((clientX - rect.left - gutter) / Math.max(1, columnWidth))
      const index = Math.max(0, Math.min(dates.length - 1, rawIndex))
      return {
        date: dates[index],
        minutes: minutesAt(clientY - rect.top, { dayStartHour, dayEndHour, snapMinutes }),
      }
    },
    [dates, dayStartHour, dayEndHour, snapMinutes],
  )

  const finish = useCallback(() => {
    const current = session.current
    session.current = null
    if (!current) return
    current.target.releasePointerCapture?.(current.pointerId)
    setPreview((live) => {
      if (current.moved && live) {
        justDragged.current = true
        // Cleared after the click that follows this release has been swallowed.
        setTimeout(() => (justDragged.current = false), 0)
        onCommit(live)
      }
      return null
    })
  }, [onCommit])

  const begin = useCallback(
    (e: React.PointerEvent, kind: DragKind, occ: Occurrence | null) => {
      // Ignore right-clicks and anything already captured.
      if (e.button !== 0 || session.current) return
      const at = locate(e.clientX, e.clientY)
      if (!at) return

      const origin: DragOrigin =
        occ && kind !== 'create'
          ? {
              kind,
              anchorMinutes: at.minutes,
              anchorDate: at.date,
              start: occ.start,
              end: occ.end,
              allDay: occ.allDay,
            }
          : {
              kind: 'create',
              anchorMinutes: at.minutes,
              anchorDate: at.date,
              start: dt.withTime(at.date, at.minutes),
              end: dt.withTime(at.date, at.minutes + defaultMinutes),
              allDay: false,
            }

      const target = e.currentTarget as HTMLElement
      target.setPointerCapture?.(e.pointerId)
      session.current = {
        origin,
        from: { x: e.clientX, y: e.clientY },
        moved: false,
        occ,
        pointerId: e.pointerId,
        target,
      }

      // A plain click on empty space should still create something, so the
      // preview exists from the first frame for `create` but not for `move`,
      // where a click means "open the editor".
      if (origin.kind === 'create') {
        const result = applyDrag(origin, at, { minMinutes: defaultMinutes, dayEndHour })
        setPreview({ kind: 'create', occ: null, ...result })
        session.current.moved = true
      }
    },
    [locate, defaultMinutes, dayEndHour],
  )

  const move = useCallback(
    (e: React.PointerEvent) => {
      const current = session.current
      if (!current) return
      if (!current.moved && !isDrag(current.from, { x: e.clientX, y: e.clientY })) return

      const at = locate(e.clientX, e.clientY)
      if (!at) return
      current.moved = true

      const result: DragResult = applyDrag(current.origin, at, {
        minMinutes: current.origin.kind === 'create' ? defaultMinutes : snapMinutes,
        dayEndHour,
      })
      setPreview({ kind: current.origin.kind, occ: current.occ, ...result })
    },
    [locate, snapMinutes, defaultMinutes, dayEndHour],
  )

  return {
    gridRef,
    preview,
    /** True if the last pointer release was the end of a drag, not a click. */
    justDragged,
    /** Spread onto the grid container. */
    handlers: {
      onPointerMove: move,
      onPointerUp: finish,
      onPointerCancel: finish,
    },
    beginCreate: (e: React.PointerEvent) => begin(e, 'create', null),
    beginMove: (e: React.PointerEvent, occ: Occurrence) => begin(e, 'move', occ),
    beginResize: (e: React.PointerEvent, occ: Occurrence, edge: 'start' | 'end') =>
      begin(e, edge === 'start' ? 'resize-start' : 'resize-end', occ),
    /** Pixel height of one hour, for the preview block. */
    hourPx: HOUR_PX,
  }
}
