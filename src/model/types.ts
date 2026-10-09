// The small value types every layer shares. Plain objects, so they cross to
// the mesher isolate as they are.

export interface Vec3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface Quat {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly w: number
}

/** An 8-bit sRGB colour. */
export interface Rgb8 {
  readonly r: number
  readonly g: number
  readonly b: number
}

/** An 8-bit sRGB colour with an 8-bit alpha. */
export interface RGBA extends Rgb8 {
  readonly a: number
}
