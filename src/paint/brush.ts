// The brush: a drag becomes dabs in the journal, and the journal becomes
// the field under the finger. Ported from big-mesh-studios' sdf-modeller
// unwrapping/paint-brush.ts.
//
// Dabs are spaced by distance along the surface, not by pointer event (an
// event is a rate, not a place), and a sample on another part starts a new
// run rather than joining across empty space. Every move re-rasterises the
// whole open stroke into the field as it was before the stroke began
// (UnderStroke), because compositing a stroke twice lands on different
// bytes than once; a field painted this way equals one replayed from the
// journal.

import type { RGBA, Vec3 } from "../model/types"
import type { PaintField, Texel } from "./field"
import type { PaintJournal } from "./journal"
import { rasterise, type PaintTarget, type Placed } from "./rasterise"

export interface BrushSettings {
  /** The disc's radius in world units. */
  readonly radius: number
  /** 0 for an airbrush, 1 for a hard edge. */
  readonly hardness: number
  readonly colour: RGBA
}

/** One surface hit, already resolved to a part. */
export interface SurfaceHit {
  readonly point: Vec3
  readonly normal: Vec3
  /** An index into the parts list. */
  readonly part: number
}

/** The smallest gap between dabs, as a fraction of the radius: three overlap across any diameter. */
const SPACING = 1 / 3

/** Turns a world point and normal into the owning part's own frame. */
export type Localiser = (part: number, point: Vec3, normal: Vec3) => { centre: readonly [number, number, number]; normal: readonly [number, number, number] }

export interface StrokeResult {
  readonly dabs: number
  /** Whether the stroke changed a voxel. */
  readonly live: number
}

/** The field with the stroke in progress rolled back out: what was under each voxel, kept on first touch. */
class UnderStroke implements PaintTarget {
  constructor(
    private readonly inner: PaintField,
    private readonly under = new Map<number, Texel>(),
  ) {}

  get voxelSize(): number {
    return this.inner.voxelSize
  }

  get voxels(): readonly [number, number, number] {
    return this.inner.voxels
  }

  worldAt = (x: number, y: number, z: number) => this.inner.worldAt(x, y, z)

  voxelAt = (wx: number, wy: number, wz: number) => this.inner.voxelAt(wx, wy, wz)

  get = (x: number, y: number, z: number): Texel => {
    let key = x + y * this.inner.voxels[0] + z * this.inner.voxels[0] * this.inner.voxels[1]
    return this.under.get(key) ?? this.inner.get(x, y, z)
  }

  set = (x: number, y: number, z: number, colour: Texel): boolean => {
    let key = x + y * this.inner.voxels[0] + z * this.inner.voxels[0] * this.inner.voxels[1]
    if (!this.under.has(key)) this.under.set(key, this.inner.get(x, y, z))
    return this.inner.set(x, y, z, colour)
  }

  /** Forgets the stroke, because it is in the field now. */
  release = (): void => {
    this.under.clear()
  }
}

/** One drag, as a run of dabs. */
export class PaintBrush {
  private previous: { point: Vec3; part: number } | undefined
  private added = 0
  private live = 0
  /** How many of the journal's dabs are already in the field. */
  private written = 0
  private readonly stroke: UnderStroke

  constructor(
    private readonly journal: PaintJournal,
    private readonly field: PaintField,
    private readonly settings: BrushSettings,
    private readonly localise: Localiser,
    private readonly place: (part: number, centre: Vec3, normal: Vec3) => Placed | undefined,
  ) {
    this.stroke = new UnderStroke(this.field)
  }

  get count(): number {
    return this.added
  }

  /**
   * Adds dabs from the last sample to here. A first sample always adds one
   * (a tap is a mark); a jump is capped at 256 steps, since a drag leaving
   * the model would otherwise paint a chord through its inside.
   */
  moveTo = (hit: SurfaceHit): void => {
    let last = this.previous
    let gap = this.settings.radius * SPACING
    if (last !== undefined && last.part === hit.part) {
      let travel = Math.hypot(hit.point.x - last.point.x, hit.point.y - last.point.y, hit.point.z - last.point.z)
      if (travel < gap) return
      let steps = Math.min(Math.floor(travel / gap), 256)
      for (let step = 1; step <= steps; step++) {
        let at = step / steps
        this.add({
          point: { x: last.point.x + (hit.point.x - last.point.x) * at, y: last.point.y + (hit.point.y - last.point.y) * at, z: last.point.z + (hit.point.z - last.point.z) * at },
          normal: hit.normal,
          part: hit.part,
        })
      }
      this.previous = { point: hit.point, part: hit.part }
      this.paint()
      return
    }
    this.add(hit)
    this.previous = { point: hit.point, part: hit.part }
    this.paint()
  }

  // The whole open stroke, from where it began, so the field never lags the finger.
  private paint = (): void => {
    if (this.written === this.journal.count) return
    let result = rasterise(this.journal, this.stroke, this.place, this.journal.openStart, this.journal.count)
    this.written = this.journal.count
    if (result.live > 0) this.live = 1
  }

  private add(hit: SurfaceHit): void {
    let local = this.localise(hit.part, hit.point, hit.normal)
    this.journal.append({ centre: local.centre, normal: local.normal, radius: this.settings.radius, hardness: this.settings.hardness, colour: this.settings.colour, part: hit.part })
    this.added += 1
  }

  /** Closes the stroke, one undo step; nothing left to rasterise. */
  finish = (): StrokeResult => {
    if (this.added === 0) {
      this.stroke.release()
      return { dabs: 0, live: 0 }
    }
    this.journal.endStroke()
    this.previous = undefined
    this.written = this.journal.count
    this.stroke.release()
    return { dabs: this.added, live: this.live }
  }
}
