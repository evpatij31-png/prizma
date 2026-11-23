/**
 * Keyboard shortcuts.
 *
 * Matched on `code`, not `key`. On a Russian layout the M/W/D/A keys report
 * `key` as "ь", "ц", "в", "ф" — so a `key`-based binding would simply stop
 * working for the very users this interface is written for, and only for
 * them. `code` names the physical key and is layout-independent.
 */

export type HotkeyAction =
  | 'view-month'
  | 'view-week'
  | 'view-day'
  | 'view-agenda'
  | 'today'
  | 'prev'
  | 'next'
  | 'new-event'
  | 'search'
  | 'close'
  | 'delete'

const BY_CODE: Record<string, HotkeyAction> = {
  KeyM: 'view-month',
  KeyW: 'view-week',
  KeyD: 'view-day',
  KeyA: 'view-agenda',
  KeyT: 'today',
  KeyN: 'new-event',
  ArrowLeft: 'prev',
  ArrowRight: 'next',
  Escape: 'close',
  Delete: 'delete',
  Backspace: 'delete',
}

export interface KeyLike {
  code: string
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  target?: unknown
}

/** Is the user typing into something? Then the key is theirs, not ours. */
export function isTyping(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false
  const el = target as { tagName?: string; isContentEditable?: boolean }
  if (el.isContentEditable) return true
  const tag = (el.tagName ?? '').toUpperCase()
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * The action a key event should trigger, or null.
 *
 * Escape is the one shortcut that still fires while typing — it is how you
 * get out of a field — and modifier combinations are left to the browser.
 */
export function resolveHotkey(event: KeyLike): HotkeyAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null

  const typing = isTyping(event.target)
  if (event.code === 'Escape') return 'close'
  if (typing) return null

  // `/` sits on different physical keys across layouts, so this one is matched
  // by the character produced rather than by position.
  if (event.key === '/' && !event.shiftKey) return 'search'

  return BY_CODE[event.code] ?? null
}

export const HOTKEY_HINTS: { keys: string; what: string }[] = [
  { keys: 'M / W / D / A', what: 'Месяц, неделя, день, список' },
  { keys: 'T', what: 'Сегодня' },
  { keys: '← / →', what: 'Предыдущий и следующий интервал' },
  { keys: 'N', what: 'Новое событие' },
  { keys: '/', what: 'Поиск' },
  { keys: 'Esc', what: 'Закрыть панель' },
  { keys: 'Delete', what: 'Удалить выбранное' },
]
