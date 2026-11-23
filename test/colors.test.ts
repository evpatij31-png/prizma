import { test } from 'node:test'
import assert from 'node:assert/strict'

import { AA_NORMAL, COLOR_KEYS, PALETTE, contrastRatio, luminance, textOn, swatch } from '../src/lib/colors.ts'

test('contrast maths matches known WCAG values', () => {
  // Black on white is the textbook maximum.
  assert.equal(Math.round(contrastRatio('#000000', '#ffffff')), 21)
  assert.equal(contrastRatio('#ffffff', '#ffffff'), 1)
  assert.ok(Math.abs(luminance('#ffffff') - 1) < 1e-9)
  assert.ok(luminance('#000000') === 0)
  // Order must not matter.
  assert.equal(contrastRatio('#0369a1', '#ffffff'), contrastRatio('#ffffff', '#0369a1'))
})

test('short hex and malformed hex are handled', () => {
  assert.equal(luminance('#fff'), luminance('#ffffff'))
  assert.throws(() => luminance('#xyz'), /Not a hex colour/)
})

test('every swatch clears 4.5:1 at BOTH ends of its gradient', () => {
  // The lighter end of a gradient is where contrast fails, so checking only
  // one end — or only the dot colour — would let an unreadable block through.
  for (const key of COLOR_KEYS) {
    const s = PALETTE[key]
    const text = textOn(key)
    for (const [end, bg] of [['from', s.from], ['to', s.to]] as const) {
      const ratio = contrastRatio(text, bg)
      assert.ok(
        ratio >= AA_NORMAL,
        `${key}.${end} (${bg}) on ${text} is ${ratio.toFixed(2)}:1, needs ${AA_NORMAL}:1`,
      )
    }
  }
})

test('the palette has all ten keys and no duplicate gradients', () => {
  assert.equal(COLOR_KEYS.length, 10)
  const seen = new Set(COLOR_KEYS.map((k) => `${PALETTE[k].from}${PALETTE[k].to}`))
  assert.equal(seen.size, 10)
})

test('an unknown colour key falls back instead of throwing', () => {
  assert.equal(swatch(undefined).key, 'violet')
  assert.equal(swatch('not-a-colour').key, 'violet')
  assert.equal(swatch('rose').key, 'rose')
})
