// The model as a field: the signed distance of the folded parts at a point,
// its gradient, and the colour of the surface there. Ported from
// big-mesh-studios' packages/csg (operations.ts, field.ts and the colour
// rule of bvh.ts). Pure and allocation-free on the hot path: it runs in the
// mesher isolate, under an interpreter, once per sample.

import type { Part } from "./part"
import { compileShape, primitiveHalfExtents, type Distance } from "./primitives"
import type { Rgb8 } from "./types"

/** The distance the fold starts from and never exceeds. */
export const FAR_DISTANCE = 100
/** How many softness widths a soft blend reaches past a shape's box. */
export const SOFTNESS_REACH = 4
/** How far from its own surface a part still has a say in colour. */
export const PAINT_REACH = 1
/** The colour of a surface no coloured part is near. */
export const DEFAULT_COLOUR: Rgb8 = { r: 190, g: 186, b: 176 }

/** A colour and an opacity packed as 0xRRGGBBAA, the key colour seams split on. */
export type PaintKey = number

export const packPaint = (colour: Rgb8, opacity: number): PaintKey =>
  ((colour.r << 24) | (colour.g << 16) | (colour.b << 8) | Math.round(Math.max(0, Math.min(1, opacity)) * 255)) >>> 0

export const DEFAULT_PAINT: PaintKey = packPaint(DEFAULT_COLOUR, 1)

interface Op {
  readonly subtract: boolean
  readonly k: number
  readonly ox: number
  readonly oy: number
  readonly oz: number
  // The conjugate of the orientation: world into the part's own frame.
  readonly qx: number
  readonly qy: number
  readonly qz: number
  readonly qw: number
  readonly rotated: boolean
  readonly distance: Distance
  readonly minX: number
  readonly minY: number
  readonly minZ: number
  readonly maxX: number
  readonly maxY: number
  readonly maxZ: number
  /** The part's paint, or -1 for a part with no colour. */
  readonly paint: number
}

/** The world box of a part's rotated half-extents, grown by `pad`. */
export const partBox = (part: Part, pad: number): [number, number, number, number, number, number] => {
  let half = primitiveHalfExtents(part.shape)
  let q = part.orientation
  let box: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  for (let corner = 0; corner < 8; corner++) {
    let vx = (corner & 1 ? 1 : -1) * half.x
    let vy = (corner & 2 ? 1 : -1) * half.y
    let vz = (corner & 4 ? 1 : -1) * half.z
    let tx = 2 * (q.y * vz - q.z * vy)
    let ty = 2 * (q.z * vx - q.x * vz)
    let tz = 2 * (q.x * vy - q.y * vx)
    let wx = vx + q.w * tx + (q.y * tz - q.z * ty) + part.origin.x
    let wy = vy + q.w * ty + (q.z * tx - q.x * tz) + part.origin.y
    let wz = vz + q.w * tz + (q.x * ty - q.y * tx) + part.origin.z
    box[0] = Math.min(box[0], wx - pad)
    box[1] = Math.min(box[1], wy - pad)
    box[2] = Math.min(box[2], wz - pad)
    box[3] = Math.max(box[3], wx + pad)
    box[4] = Math.max(box[4], wy + pad)
    box[5] = Math.max(box[5], wz + pad)
  }
  return box
}

const compile = (part: Part): Op => {
  // The candidate box: a soft blend reaches four softness widths past the
  // shape, and the extra unit is upstream's slack for the inexact shapes.
  let box = partBox(part, part.softness * SOFTNESS_REACH + 1)
  let q = part.orientation
  let colour = part.colour ?? undefined
  return {
    subtract: part.combine === "Subtract",
    k: part.softness * 4,
    ox: part.origin.x,
    oy: part.origin.y,
    oz: part.origin.z,
    qx: -q.x,
    qy: -q.y,
    qz: -q.z,
    qw: q.w,
    rotated: q.x !== 0 || q.y !== 0 || q.z !== 0,
    distance: compileShape(part.shape),
    minX: box[0],
    minY: box[1],
    minZ: box[2],
    maxX: box[3],
    maxY: box[4],
    maxZ: box[5],
    paint: colour === undefined ? -1 : packPaint(colour, part.opacity ?? 1),
  }
}

const opDistance = (op: Op, x: number, y: number, z: number): number => {
  let vx = x - op.ox
  let vy = y - op.oy
  let vz = z - op.oz
  if (!op.rotated) return op.distance(vx, vy, vz)
  let tx = 2 * (op.qy * vz - op.qz * vy)
  let ty = 2 * (op.qz * vx - op.qx * vz)
  let tz = 2 * (op.qx * vy - op.qy * vx)
  return op.distance(vx + op.qw * tx + (op.qy * tz - op.qz * ty), vy + op.qw * ty + (op.qz * tx - op.qx * tz), vz + op.qw * tz + (op.qx * ty - op.qy * tx))
}

const boxDistanceSquared = (op: Op, x: number, y: number, z: number): number => {
  let dx = x < op.minX ? op.minX - x : x > op.maxX ? x - op.maxX : 0
  let dy = y < op.minY ? op.minY - y : y > op.maxY ? y - op.maxY : 0
  let dz = z < op.minZ ? op.minZ - z : z > op.maxZ ? z - op.maxZ : 0
  return dx * dx + dy * dy + dz * dz
}

/** The polynomial smooth minimum: min(a, b) - max(k - |a - b|, 0)^2 / 4k. */
export const smoothMin = (a: number, b: number, k: number): number => {
  if (k <= 0) return a < b ? a : b
  let h = k - Math.abs(a - b)
  if (h < 0) h = 0
  return (a < b ? a : b) - (h * h) / (4 * k)
}

export const smoothMax = (a: number, b: number, k: number): number => -smoothMin(-a, -b, k)

/** A model's parts compiled for sampling. */
export class Field {
  private readonly ops: Op[]
  private readonly painted: Op[]

  constructor(parts: readonly Part[]) {
    this.ops = parts.map(compile)
    this.painted = this.ops.filter(op => op.paint >= 0)
  }

  get empty(): boolean {
    return this.ops.length === 0
  }

  /** The folded signed distance: negative inside the model. */
  distance(x: number, y: number, z: number): number {
    let field = FAR_DISTANCE
    let ops = this.ops
    for (let i = 0; i < ops.length; i++) {
      let op = ops[i]!
      // An op whose box is further than it could change the field is
      // skipped: a union cannot lower it from there, a cut cannot raise it.
      let reach = op.subtract ? op.k - field : field + op.k
      if (reach > 0 && boxDistanceSquared(op, x, y, z) >= reach * reach) continue
      let d = opDistance(op, x, y, z)
      field = op.subtract ? smoothMax(field, -d, op.k) : smoothMin(field, d, op.k)
      if (field > FAR_DISTANCE) field = FAR_DISTANCE
    }
    return field
  }

  /** The unit gradient by central differences `h` apart, into `out`; false where it vanishes. */
  gradient(x: number, y: number, z: number, h: number, out: { x: number; y: number; z: number }): boolean {
    let dx = this.distance(x + h, y, z) - this.distance(x - h, y, z)
    let dy = this.distance(x, y + h, z) - this.distance(x, y - h, z)
    let dz = this.distance(x, y, z + h) - this.distance(x, y, z - h)
    let length = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (length === 0) return false
    out.x = dx / length
    out.y = dy / length
    out.z = dz / length
    return true
  }

  /**
   * The paint of the surface at a point: among the coloured parts near
   * enough to have a say, the one whose own surface is closest, later parts
   * winning ties (upstream ADR 0031). Nothing near is DEFAULT_PAINT.
   */
  paintAt(x: number, y: number, z: number): PaintKey {
    let found = DEFAULT_PAINT
    let nearest = Infinity
    let painted = this.painted
    for (let i = 0; i < painted.length; i++) {
      let op = painted[i]!
      if (x < op.minX || x > op.maxX || y < op.minY || y > op.maxY || z < op.minZ || z > op.maxZ) continue
      let d = opDistance(op, x, y, z)
      if (d > PAINT_REACH) continue
      let away = d < 0 ? -d : d
      if (away <= nearest) {
        nearest = away
        found = op.paint
      }
    }
    return found
  }
}

/** The part whose own surface is nearest a point (a picked hit), or undefined for no parts. */
export const nearestPart = (parts: readonly Part[], x: number, y: number, z: number): Part | undefined => {
  let found: Part | undefined
  let nearest = Infinity
  for (let part of parts) {
    let d = Math.abs(opDistance(compile(part), x, y, z))
    if (d <= nearest) {
      nearest = d
      found = part
    }
  }
  return found
}

/** The region a model is sampled over: its parts' boxes, grown for blends and by `padding`. */
export const fieldBounds = (parts: readonly Part[], padding: number): [number, number, number, number, number, number] | undefined => {
  if (parts.length === 0) return undefined
  let bounds: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  for (let part of parts) {
    let box = partBox(part, part.softness * SOFTNESS_REACH + padding)
    for (let axis = 0; axis < 3; axis++) {
      bounds[axis] = Math.min(bounds[axis]!, box[axis]!)
      bounds[axis + 3] = Math.max(bounds[axis + 3]!, box[axis + 3]!)
    }
  }
  return bounds
}
