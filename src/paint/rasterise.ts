// Rasterising a journal into a field: the only place paint becomes bytes.
// Ported from big-mesh-studios' sdf-modeller unwrapping/paint-rasterise.ts.
//
// A pure function of (journal, field, place), so undo, redo and loading
// are all "clear and replay". The caller places each dab (its part's
// transform), and `place` returning undefined skips one. A dab is a disc
// laid on the surface, written only in a thin shell around it, so a hollow
// figure is not painted through. Each stroke composites once: coverage is
// the maximum over its dabs (a falloff compounded dab by dab turns a soft
// brush hard), opacity the product (an airbrush held still still builds),
// colour the weighted average. Culling is a report: a dab that changed
// nothing stays in the journal, or undoing what covered it would leave a hole.

import type { Vec3 } from "../model/types"
import type { Texel } from "./field"
import type { PaintJournal } from "./journal"

/**
 * How far off the surface a voxel may be and still be painted, in voxels:
 * the thinnest shell that cannot miss the surface the brush resolved to a
 * fifth of a voxel.
 */
const SHELL_VOXELS = 1.5

/**
 * The falloff: 1 inside `hardness`, a smoothstep down to 0 past the rim.
 * `band` widens the ramp to a voxel and a half so a hard edge is
 * antialiased rather than stepped; the 50% crossing stays on the radius.
 */
const falloff = (distance: number, hardness: number, band: number): number => {
  let t = (distance - hardness) / Math.max(1 - hardness, band)
  if (t <= 0) return 1
  if (t >= 1) return 0
  return 1 - t * t * (3 - 2 * t)
}

/** A dab's world position and facing, as its part's transform puts them. */
export interface Placed {
  readonly centre: Vec3
  /** Unit length. */
  readonly normal: Vec3
}

/**
 * What a rasterisation writes into. An interface rather than the field, so
 * the brush can hand in the field with the open stroke rolled back out.
 */
export interface PaintTarget {
  readonly voxelSize: number
  readonly voxels: readonly [number, number, number]
  voxelAt(wx: number, wy: number, wz: number): [number, number, number]
  worldAt(x: number, y: number, z: number): [number, number, number]
  get(x: number, y: number, z: number): Texel
  set(x: number, y: number, z: number, colour: Texel): boolean
}

export interface RasteriseResult {
  /** Strokes that changed a voxel; the rest changed nothing and are cullable. */
  readonly live: number
  /** How many dabs were considered (the range's length). */
  readonly dabs: number
}

/** One stroke's accumulation at one voxel, before it is composited. */
interface Accum {
  /** Σ alpha × coverage, the colour's normaliser. */
  w: number
  /** The furthest any single dab's falloff reached here. */
  reach: number
  /** Π (1 - alpha), so 1 - transmit is the stroke's opacity. */
  transmit: number
  r: number
  g: number
  b: number
}

/**
 * Writes the dabs `from..to` (the whole journal by default) into the
 * field. A range is safe because strokes before it are already there and
 * the stroke it ends inside is written as one group; anything that changes
 * what is already in the field clears it first and replays the lot.
 */
export const rasterise = (journal: PaintJournal, field: PaintTarget, place: (part: number, centre: Vec3, normal: Vec3) => Placed | undefined, from = 0, to = journal.count): RasteriseResult => {
  let live = 0
  let voxel = field.voxelSize
  let [sizeX, sizeY, sizeZ] = field.voxels
  let shell = SHELL_VOXELS * voxel
  let group = new Map<number, Accum>()
  let ends = new Set(journal.strokeEnds)

  // Composites one stroke's accumulation over the field, in insertion order.
  let commit = () => {
    if (group.size === 0) return
    let changed = false
    for (let [key, a] of group) {
      if (a.w <= 0) continue
      let x = key % sizeX
      let y = ((key - x) / sizeX) % sizeY
      let z = Math.floor(key / (sizeX * sizeY))
      let alpha = Math.round((1 - a.transmit) * a.reach * 255)
      if (alpha <= 0) continue
      let over = alpha / 255
      let keep = 1 - over
      let previous = field.get(x, y, z)
      changed =
        field.set(x, y, z, {
          r: Math.round((a.r / a.w) * over + previous.r * keep),
          g: Math.round((a.g / a.w) * over + previous.g * keep),
          b: Math.round((a.b / a.w) * over + previous.b * keep),
          a: Math.round(alpha + previous.a * keep),
        }) || changed
    }
    group.clear()
    if (changed) live += 1
  }

  for (let dab = from; dab < to; dab++) {
    let placed = place(
      journal.part[dab]!,
      { x: journal.centre[dab * 3]!, y: journal.centre[dab * 3 + 1]!, z: journal.centre[dab * 3 + 2]! },
      { x: journal.normal[dab * 3]!, y: journal.normal[dab * 3 + 1]!, z: journal.normal[dab * 3 + 2]! },
    )
    if (placed === undefined) continue

    let radius = journal.radius[dab]!
    // The widest ramp the grid resolves, capped at the brush's own radius
    // so a brush narrower than the grid fades rather than blooms.
    let band = Math.min((1.5 * voxel) / radius, 1)
    let outer = radius * (1 + band)
    // A sphere bound: the voxels just off the surface along the normal count.
    let reach = outer + shell + voxel
    let span = Math.ceil(reach / voxel)
    let half = voxel * 0.5
    let [vx, vy, vz] = field.voxelAt(placed.centre.x, placed.centre.y, placed.centre.z)
    let x0 = vx - span
    let y0 = vy - span
    let z0 = vz - span
    let x1 = Math.min(vx + span, sizeX - 1)
    let y1 = Math.min(vy + span, sizeY - 1)
    let z1 = Math.min(vz + span, sizeZ - 1)
    if (x1 < x0 || y1 < y0 || z1 < z0) continue

    let [wx0, wy0, wz0] = field.worldAt(x0, y0, z0)
    let nx = placed.normal.x
    let ny = placed.normal.y
    let nz = placed.normal.z
    let hardness = journal.hardness[dab]!
    let red = journal.colour[dab * 4]!
    let green = journal.colour[dab * 4 + 1]!
    let blue = journal.colour[dab * 4 + 2]!
    let alpha = journal.colour[dab * 4 + 3]! / 255
    let trans = 1 - alpha

    for (let z = z0; z <= z1; z++) {
      let wz = wz0 + (z - z0) * voxel
      for (let y = y0; y <= y1; y++) {
        let wy = wy0 + (y - y0) * voxel
        let wx = wx0
        for (let x = x0; x <= x1; x++, wx += voxel) {
          let dx = wx - placed.centre.x
          let dy = wy - placed.centre.y
          let dz = wz - placed.centre.z
          let squared = dx * dx + dy * dy + dz * dz
          if (squared > reach * reach) continue
          let across = dx * nx + dy * ny + dz * nz
          // Only the shell around the surface is painted.
          let offSurface = across < 0 ? -across : across
          if (offSurface > shell + half) continue
          // In the plane, so a round brush stays round on a curve.
          let inPlaneSq = squared - across * across
          let inPlane = inPlaneSq < 0 ? 0 : Math.sqrt(inPlaneSq)
          if (inPlane > outer) continue
          // Faded towards the shell's edge rather than cut off at it.
          let coverage = falloff(inPlane / radius, hardness, band) * falloff(offSurface / shell, 1, shell / voxel)
          if (coverage <= 0) continue

          let key = x + y * sizeX + z * sizeX * sizeY
          let at = group.get(key)
          if (at === undefined) {
            at = { w: 0, reach: 0, transmit: 1, r: 0, g: 0, b: 0 }
            group.set(key, at)
          }
          let weight = alpha * coverage
          at.w += weight
          if (coverage > at.reach) at.reach = coverage
          at.transmit *= trans
          at.r += red * weight
          at.g += green * weight
          at.b += blue * weight
        }
      }
    }

    if (ends.has(dab + 1)) commit()
  }
  commit()
  return { live, dabs: Math.max(0, to - from) }
}
