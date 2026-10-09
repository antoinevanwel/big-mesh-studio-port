// Colour conversions the picker and the palette need. Channels are 0..255
// (alpha too); HSVA is hue in degrees and saturation, value, alpha in 0..1.

import type { RGBA, Rgb8 } from "./types"

export interface HSVA {
  readonly h: number
  readonly s: number
  readonly v: number
  readonly a: number
}

export const rgbaToCss = ({ r, g, b, a }: RGBA): string => `rgba(${r},${g},${b},${Math.round((a / 255) * 1000) / 1000})`

export const rgbToHex = ({ r, g, b }: Rgb8): string => `#${[r, g, b].map(c => c.toString(16).padStart(2, "0")).join("")}`

export const sameRgba = (a: RGBA, b: RGBA): boolean => a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a

export const hsvaToRgba = ({ h, s, v, a }: HSVA): RGBA => {
  let hue = (((h % 360) + 360) % 360) / 60
  let c = v * s
  let x = c * (1 - Math.abs((hue % 2) - 1))
  let [r, g, b] = hue < 1 ? [c, x, 0] : hue < 2 ? [x, c, 0] : hue < 3 ? [0, c, x] : hue < 4 ? [0, x, c] : hue < 5 ? [x, 0, c] : [c, 0, x]
  let m = v - c
  let byte = (channel: number) => Math.round((channel + m) * 255)
  return { r: byte(r), g: byte(g), b: byte(b), a: Math.round(a * 255) }
}

/**
 * The colour in HSVA. Hue is undefined for a grey and saturation for black,
 * so those keep `previous`'s: dragging the value to zero and back must not
 * forget which hue the person had picked.
 */
export const rgbaToHsva = ({ r, g, b, a }: RGBA, previous: HSVA): HSVA => {
  let rf = r / 255
  let gf = g / 255
  let bf = b / 255
  let max = Math.max(rf, gf, bf)
  let min = Math.min(rf, gf, bf)
  let delta = max - min
  let h = previous.h
  if (delta > 0) {
    if (max === rf) h = 60 * (((gf - bf) / delta + 6) % 6)
    else if (max === gf) h = 60 * ((bf - rf) / delta + 2)
    else h = 60 * ((rf - gf) / delta + 4)
  }
  let s = max === 0 ? previous.s : delta / max
  return { h, s, v: max, a: a / 255 }
}
