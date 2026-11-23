/**
 * Generate the PWA icons.
 *
 * Drawn here rather than exported from a design tool, and encoded with Node's
 * own zlib rather than an image library, so `npm run icons` needs nothing
 * installed and the output is byte-for-byte reproducible. Rasterising the SVG
 * would have meant a native dependency for four small files.
 *
 * Usage: node scripts/icons.mjs
 */

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')

/** Supersampling factor: cheap anti-aliasing without a rasteriser. */
const SS = 4

const GRADIENT = [
  [0.0, [124, 58, 237]], // violet-600
  [0.55, [217, 70, 239]], // fuchsia-500
  [1.0, [34, 211, 238]], // cyan-400
]

const INK = [11, 10, 26]
const PAPER = [255, 255, 255]

function lerp(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t))
}

function gradientAt(t) {
  for (let i = 1; i < GRADIENT.length; i++) {
    const [p0, c0] = GRADIENT[i - 1]
    const [p1, c1] = GRADIENT[i]
    if (t <= p1) return lerp(c0, c1, (t - p0) / (p1 - p0))
  }
  return GRADIENT.at(-1)[1]
}

/** Signed-distance test for a rounded rectangle. */
function inRoundedRect(x, y, left, top, width, height, radius) {
  const right = left + width
  const bottom = top + height
  if (x < left || x > right || y < top || y > bottom) return false
  const cx = Math.min(Math.max(x, left + radius), right - radius)
  const cy = Math.min(Math.max(y, top + radius), bottom - radius)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= radius * radius
}

/**
 * The icon: a gradient tile with a dark calendar card on it.
 * `pad` is the fraction of the canvas left empty — a maskable icon needs a
 * safe margin or Android crops into the artwork.
 */
function draw(size, pad = 0) {
  const n = size * SS
  const rgba = Buffer.alloc(n * n * 4)
  const inset = n * pad
  const tile = { left: inset, top: inset, size: n - inset * 2 }
  const radius = tile.size * 0.235

  // Calendar card, proportional to the tile.
  const card = {
    left: tile.left + tile.size * 0.2,
    top: tile.top + tile.size * 0.265,
    w: tile.size * 0.6,
    h: tile.size * 0.53,
  }
  const cardRadius = card.w * 0.16
  const headerH = card.h * 0.26

  const bars = [
    [0.1, 0.42, 0.29, 0.95],
    [0.55, 0.42, 0.29, 0.5],
    [0.1, 0.66, 0.18, 0.5],
    [0.38, 0.66, 0.46, 0.95],
  ]

  for (let py = 0; py < n; py++) {
    for (let px = 0; px < n; px++) {
      const i = (py * n + px) * 4
      if (!inRoundedRect(px, py, tile.left, tile.top, tile.size, tile.size, radius)) continue

      // Diagonal gradient across the tile.
      const t = Math.min(1, Math.max(0, (px - tile.left + (py - tile.top)) / (tile.size * 2)))
      let [r, g, b] = gradientAt(t)

      if (inRoundedRect(px, py, card.left, card.top, card.w, card.h, cardRadius)) {
        const isHeader = py < card.top + headerH
        ;[r, g, b] = isHeader ? PAPER : blend(INK, [r, g, b], 0.88)

        if (!isHeader) {
          for (const [bx, by, bw, alpha] of bars) {
            const left = card.left + card.w * bx
            const top = card.top + card.h * by
            const w = card.w * bw
            const h = card.h * 0.1
            if (inRoundedRect(px, py, left, top, w, h, h / 2)) {
              ;[r, g, b] = blend(PAPER, [r, g, b], alpha)
            }
          }
        }
      }

      rgba[i] = r
      rgba[i + 1] = g
      rgba[i + 2] = b
      rgba[i + 3] = 255
    }
  }

  return downsample(rgba, n, size)
}

function blend(fg, bg, alpha) {
  return fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha)))
}

/** Average each SS×SS block: this is the anti-aliasing. */
function downsample(src, n, size) {
  const out = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const i = ((y * SS + dy) * n + (x * SS + dx)) * 4
          const alpha = src[i + 3] / 255
          r += src[i] * alpha
          g += src[i + 1] * alpha
          b += src[i + 2] * alpha
          a += alpha
        }
      }
      const count = SS * SS
      const i = (y * size + x) * 4
      // Un-premultiply so edge pixels keep their colour instead of darkening.
      out[i] = a ? Math.round(r / a) : 0
      out[i + 1] = a ? Math.round(g / a) : 0
      out[i + 2] = a ? Math.round(b / a) : 0
      out[i + 3] = Math.round((a / count) * 255)
    }
  }
  return out
}

/* ------------------------------ PNG encoding ------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

function crc32(buffer) {
  let c = -1
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(rgba, size) {
  // Each scanline is prefixed with filter type 0 (none).
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  // 10..12: compression, filter, interlace — all 0.

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ---------------------------------- main ---------------------------------- */

const TARGETS = [
  { file: 'icon-192.png', size: 192, pad: 0 },
  { file: 'icon-512.png', size: 512, pad: 0 },
  // Android masks icons to a circle and keeps only the inner ~80%.
  { file: 'icon-512-maskable.png', size: 512, pad: 0.1 },
  { file: 'apple-touch-icon.png', size: 180, pad: 0 },
]

mkdirSync(OUT, { recursive: true })
for (const { file, size, pad } of TARGETS) {
  const png = encodePng(draw(size, pad), size)
  writeFileSync(join(OUT, file), png)
  console.log(`${file.padEnd(26)} ${size}×${size}  ${(png.length / 1024).toFixed(1)} KB`)
}
