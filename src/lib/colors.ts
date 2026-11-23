/**
 * The calendar palette.
 *
 * Event blocks are gradients, and that is what makes contrast tricky: the text
 * sits over a range of backgrounds, not one. Both ends of a gradient must clear
 * 4.5:1 against the text colour, enforced by `test/colors.test.ts` rather than
 * by eye.
 *
 * Every swatch is a *light* gradient with dark text. The first attempt was the
 * other way round — deep backgrounds with white text — and it passed the
 * contrast test but looked dead on the dark theme: a deep cyan block on a near
 * black page is barely distinguishable from the page. Inverting it gives
 * blocks that glow against the dark UI, reads fine on the light one, and
 * actually scores *higher* contrast, since a pastel against near-black text
 * has more room than white against a mid tone.
 */

import type { ColorKey } from './types.ts'

/** Text drawn on top of an event block. */
export const ON_LIGHT = '#1c1917' // stone-900
export const ON_DARK = '#ffffff'

export interface Swatch {
  key: ColorKey
  /** Russian label for the calendar colour picker. */
  label: string
  /** Gradient start (darker end for dark swatches). */
  from: string
  /** Gradient end — the end that decides whether contrast passes. */
  to: string
  /** Which text colour this swatch is built for. */
  on: 'light' | 'dark'
  /** Flat colour for dots, borders and the calendar list. */
  dot: string
}

export const PALETTE: Record<ColorKey, Swatch> = {
  violet: { key: 'violet', label: 'Фиолетовый', from: '#c4b5fd', to: '#a78bfa', on: 'light', dot: '#a78bfa' },
  fuchsia: { key: 'fuchsia', label: 'Фуксия', from: '#f0abfc', to: '#e879f9', on: 'light', dot: '#e879f9' },
  rose: { key: 'rose', label: 'Розовый', from: '#fda4af', to: '#fb7185', on: 'light', dot: '#fb7185' },
  amber: { key: 'amber', label: 'Янтарный', from: '#fcd34d', to: '#fbbf24', on: 'light', dot: '#fbbf24' },
  lime: { key: 'lime', label: 'Лаймовый', from: '#bef264', to: '#a3e635', on: 'light', dot: '#a3e635' },
  emerald: { key: 'emerald', label: 'Изумрудный', from: '#6ee7b7', to: '#34d399', on: 'light', dot: '#34d399' },
  cyan: { key: 'cyan', label: 'Бирюзовый', from: '#67e8f9', to: '#22d3ee', on: 'light', dot: '#22d3ee' },
  sky: { key: 'sky', label: 'Небесный', from: '#7dd3fc', to: '#38bdf8', on: 'light', dot: '#38bdf8' },
  indigo: { key: 'indigo', label: 'Индиго', from: '#a5b4fc', to: '#818cf8', on: 'light', dot: '#818cf8' },
  slate: { key: 'slate', label: 'Серый', from: '#cbd5e1', to: '#94a3b8', on: 'light', dot: '#94a3b8' },
}

export const COLOR_KEYS = Object.keys(PALETTE) as ColorKey[]

export function swatch(key: ColorKey | string | undefined): Swatch {
  return PALETTE[(key as ColorKey) in PALETTE ? (key as ColorKey) : 'violet']
}

/** The text colour to draw on this swatch. */
export function textOn(key: ColorKey): string {
  return swatch(key).on === 'light' ? ON_LIGHT : ON_DARK
}

/** Inline style for an event block. */
export function blockStyle(key: ColorKey): { background: string; color: string } {
  const s = swatch(key)
  return {
    background: `linear-gradient(135deg, ${s.from}, ${s.to})`,
    color: textOn(key),
  }
}

/* ------------------------------ contrast maths ----------------------------- */

export function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`Not a hex colour: ${hex}`)
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)]
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** WCAG AA for body text. */
export const AA_NORMAL = 4.5
