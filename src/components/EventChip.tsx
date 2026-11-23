import clsx from 'clsx'

import { blockStyle, swatch } from '../lib/colors.ts'
import * as dt from '../lib/datetime.ts'
import type { Occurrence } from '../lib/types.ts'

interface Props {
  occ: Occurrence
  selected?: boolean
  /** `chip` is the compact month-grid form; `block` fills a day column. */
  variant?: 'chip' | 'block'
  onSelect?: (occ: Occurrence) => void
}

/**
 * One occurrence on screen.
 *
 * The gradient and its text colour both come from the palette, which is
 * contrast-checked in `test/colors.test.ts` — so this component never picks a
 * colour of its own, and cannot make text unreadable by accident.
 */
export function EventChip({ occ, selected = false, variant = 'chip', onSelect }: Props) {
  const colors = blockStyle(occ.color)
  const time = occ.allDay ? null : dt.formatTime(occ.start)

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onSelect?.(occ)
      }}
      style={colors}
      title={`${occ.title}${time ? ` · ${dt.formatRange(occ.start, occ.end, occ.allDay)}` : ''}`}
      aria-current={selected ? 'true' : undefined}
      className={clsx(
        'group relative flex w-full items-baseline gap-1 overflow-hidden text-left',
        'transition-[transform,box-shadow] duration-150 ease-[var(--ease-spring)]',
        'hover:z-10 hover:-translate-y-px hover:shadow-lg active:translate-y-0',
        selected && 'ring-2 ring-offset-1 ring-[var(--accent)] ring-offset-[var(--surface-1)]',
        variant === 'chip'
          ? 'rounded-md px-1.5 py-0.5 text-[11px] leading-[1.35] font-medium'
          : 'h-full rounded-lg px-2 py-1 text-xs leading-tight',
      )}
    >
      {occ.recurring && (
        <span
          aria-hidden
          className={clsx('shrink-0 opacity-70', variant === 'chip' && 'hidden sm:inline')}
          title="Повторяется"
        >
          ⟳
        </span>
      )}
      {time && (
        <span
          className={clsx(
            'shrink-0 tabular-nums opacity-85',
            // In a month cell on a phone the column is ~50px wide: showing the
            // time leaves nothing for the title, which is the part that says
            // what the event is. The time is still in the tooltip and in every
            // other view.
            variant === 'chip' && 'hidden sm:inline',
          )}
        >
          {time}
        </span>
      )}
      <span className="truncate font-semibold">{occ.title || 'Без названия'}</span>
      {occ.readOnly && (
        <span aria-hidden className="ml-auto shrink-0 opacity-70" title="Только чтение">
          🔒
        </span>
      )}
    </button>
  )
}

/** The flat colour dot used in lists, where a gradient would be noise. */
export function ColorDot({ color, className }: { color: Occurrence['color']; className?: string }) {
  return (
    <span
      aria-hidden
      className={clsx('inline-block size-2.5 shrink-0 rounded-full', className)}
      style={{ background: swatch(color).dot }}
    />
  )
}
