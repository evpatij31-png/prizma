import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { AA_NORMAL, contrastRatio } from '../src/lib/colors.ts'

/**
 * The light theme is the one that is easy to ship broken: it is built second,
 * looked at least, and a washed-out grey on white passes a glance but not a
 * reading. So both themes are checked here against the same bar as the event
 * blocks, straight from the stylesheet rather than from a copy of it.
 */

const css = readFileSync(fileURLToPath(new URL('../src/styles/theme.css', import.meta.url)), 'utf8')

/** Pull `--name: value` pairs out of one selector block. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector)
  assert.ok(start >= 0, `${selector} is missing from theme.css`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  const body = css.slice(open + 1, close)
  const out: Record<string, string> = {}
  for (const line of body.split('\n')) {
    const m = /^\s*(--[\w-]+)\s*:\s*([^;]+);/.exec(line)
    if (m) out[m[1]] = m[2].trim()
  }
  return out
}

const LIGHT = tokens(':root {')
const DARK = tokens('.dark {')

/** Text colours that must be readable on each surface. */
const PAIRS: { text: string; on: string; what: string }[] = [
  { text: '--text-primary', on: '--surface-0', what: 'основной текст на фоне страницы' },
  { text: '--text-primary', on: '--surface-1', what: 'основной текст на панели' },
  { text: '--text-primary', on: '--surface-2', what: 'основной текст на поле ввода' },
  { text: '--text-primary', on: '--surface-3', what: 'основной текст на наведении' },
  { text: '--text-secondary', on: '--surface-1', what: 'вторичный текст на панели' },
  { text: '--text-secondary', on: '--surface-2', what: 'вторичный текст на поле ввода' },
  { text: '--text-muted', on: '--surface-1', what: 'приглушённый текст на панели' },
  { text: '--text-muted', on: '--surface-0', what: 'приглушённый текст на фоне' },
  { text: '--accent-text', on: '--accent', what: 'текст на акцентной кнопке' },
]

for (const [name, theme] of [['светлая', LIGHT], ['тёмная', DARK]] as const) {
  test(`${name} тема: каждая пара текст/фон проходит 4.5:1`, () => {
    for (const pair of PAIRS) {
      const text = theme[pair.text]
      const background = theme[pair.on]
      assert.ok(text, `${pair.text} missing in ${name}`)
      assert.ok(background, `${pair.on} missing in ${name}`)
      const ratio = contrastRatio(text, background)
      assert.ok(
        ratio >= AA_NORMAL,
        `${name}: ${pair.what} — ${text} на ${background} даёт ${ratio.toFixed(2)}:1, нужно ${AA_NORMAL}:1`,
      )
    }
  })
}

test('both themes define the same set of tokens', () => {
  // A token present in one theme and missing in the other silently falls back
  // to the light value, which is how a dark theme ends up with one white box.
  assert.deepEqual(Object.keys(LIGHT).sort(), Object.keys(DARK).sort())
})

test('the themes are actually different', () => {
  assert.notEqual(LIGHT['--surface-0'], DARK['--surface-0'])
  assert.notEqual(LIGHT['--text-primary'], DARK['--text-primary'])
})

test('the dark theme is dark and the light one is light', () => {
  // Guards against the two blocks being swapped, which looks obvious in a
  // browser and invisible in a diff.
  assert.ok(contrastRatio(DARK['--surface-0'], '#000000') < 2, 'dark background should be near black')
  assert.ok(contrastRatio(LIGHT['--surface-0'], '#ffffff') < 2, 'light background should be near white')
})

test('the focus ring is visible on both themes', () => {
  for (const [name, theme] of [['светлая', LIGHT], ['тёмная', DARK]] as const) {
    // 3:1 is the WCAG bar for a non-text indicator.
    const ratio = contrastRatio(theme['--accent'], theme['--surface-0'])
    assert.ok(ratio >= 3, `${name}: кольцо фокуса ${ratio.toFixed(2)}:1, нужно 3:1`)
  }
})
