import { describeRule, presetRules } from '../../lib/recurrence.ts'
import type { Local } from '../../lib/datetime.ts'

interface Props {
  value: string | undefined
  start: Local
  disabled: boolean
  onChange(rrule: string | undefined): void
}

/**
 * Recurrence as a short list of the rules people actually use, plus a plain
 * reading of whatever rule the event already has.
 *
 * A rule imported from another calendar may be more exotic than anything in
 * the list — `BYSETPOS`, an ordinal weekday. Rather than quietly rewriting it
 * to the nearest preset, the current rule is shown as an extra option and kept
 * until the user deliberately picks something else.
 */
export function RecurrenceField({ value, start, disabled, onChange }: Props) {
  const presets = presetRules(start)
  const known = presets.some((p) => p.rrule === value)

  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-bold tracking-wide text-ink-faint uppercase">
        Повтор
      </span>
      <select
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="w-full rounded-lg border border-edge bg-surface-2 px-2.5 py-2 text-sm outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-60"
      >
        {presets.map((preset) => (
          <option key={preset.label} value={preset.rrule ?? ''}>
            {preset.label}
          </option>
        ))}
        {!known && value && <option value={value}>{describeRule(value, start)}</option>}
      </select>
      {value && (
        <p className="mt-1 text-xs text-ink-faint">{describeRule(value, start)}</p>
      )}
    </label>
  )
}
