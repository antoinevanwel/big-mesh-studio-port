// Where the brush is, found on the model's field rather than on a facet of
// its mesh. Ported from big-mesh-studios' sdf-modeller view/field-hit.ts,
// with the sphere trace of packages/picking (pickAlong) it calls.
//
// The ray is sphere-traced to within half a default voxel, then three
// Newton steps on the signed distance pull the point onto the surface to a
// hundredth of a unit, and the normal comes from the field's gradient. No
// mesh is involved, so where a stroke lands does not depend on the
// viewport's resolution (upstream's brush stopped finding the surface at a
// coarse one while it raycast the mesh). The part is named as a tap names
// it: the one whose own surface is nearest the point.

import type { Field } from "../model/field"
import { distanceToPart, type Part } from "../model/part"
import type { Vec3 } from "../model/types"

/** How close a brush hit gets to the true surface, in world units. */
export const BRUSH_EPSILON = 0.01
/** Newton steps from the trace's end point. */
const REFINE_STEPS = 3
/** How far the trace reaches, in world units. */
const REACH = 1000
/** Where the coarse trace stops: half the mesher's default voxel. */
const TRACE_EPSILON = 0.125
/** A cap on trace steps, so a grazing ray costs time rather than hanging. */
const MAX_STEPS = 4096

export interface FieldHit {
  /** On the surface, to within BRUSH_EPSILON. */
  readonly point: Vec3
  /** Outward from the field's gradient, turned to face the ray. */
  readonly normal: Vec3
  /** Which part put the surface here, as an index into the parts list. */
  readonly part: number
}

/** What the brush works against: the folded field, its gradient spacing, and the parts it folds. */
export interface BrushSurface {
  readonly field: Field
  /** The central-difference spacing for the gradient: the mesh region's sample size. */
  readonly step: number
  readonly parts: readonly Part[]
}

const scratch = { x: 0, y: 0, z: 0 }

/** The first point along the ray within `epsilon` of the surface (or the origin, when it starts inside). */
const traceAlong = (field: Field, origin: Vec3, direction: Vec3): Vec3 | undefined => {
  let length = Math.hypot(direction.x, direction.y, direction.z)
  if (length === 0) return undefined
  let dx = direction.x / length
  let dy = direction.y / length
  let dz = direction.z / length
  let travelled = 0
  for (let steps = 0; steps < MAX_STEPS && travelled <= REACH; steps++) {
    let x = origin.x + dx * travelled
    let y = origin.y + dy * travelled
    let z = origin.z + dz * travelled
    let reported = field.distance(x, y, z)
    if (reported <= TRACE_EPSILON) return { x, y, z }
    travelled += reported
  }
  return undefined
}

/** A Newton step on the signed distance: `p - d ∇d` lands on the surface, quadratically near it. */
const refine = (surface: BrushSurface, from: Vec3): Vec3 => {
  let { x, y, z } = from
  for (let step = 0; step < REFINE_STEPS; step++) {
    let distance = surface.field.distance(x, y, z)
    if (Math.abs(distance) <= BRUSH_EPSILON) break
    if (!surface.field.gradient(x, y, z, surface.step, scratch)) break
    x -= distance * scratch.x
    y -= distance * scratch.y
    z -= distance * scratch.z
  }
  return { x, y, z }
}

/** The part whose own surface is nearest a point; the first wins a tie, -1 for no parts. */
export const partIndexAt = (parts: readonly Part[], point: Vec3): number => {
  let best = -1
  let bestAway = Infinity
  for (let part = 0; part < parts.length; part++) {
    let away = Math.abs(distanceToPart(parts[part]!, point))
    if (away < bestAway) {
      bestAway = away
      best = part
    }
  }
  return best
}

/** The surface under a ray, or undefined for a ray that misses. */
export const fieldHitAlong = (surface: BrushSurface, origin: Vec3, direction: Vec3): FieldHit | undefined => {
  let near = traceAlong(surface.field, origin, direction)
  if (near === undefined) return undefined
  let point = refine(surface, near)
  let normal = surface.field.gradient(point.x, point.y, point.z, surface.step, scratch) ? { x: scratch.x, y: scratch.y, z: scratch.z } : { x: 0, y: 1, z: 0 }
  // A disc is the same from either side; one standing inside reads as a bug.
  let facing = normal.x * direction.x + normal.y * direction.y + normal.z * direction.z
  let outward = facing < 0 ? { x: -normal.x, y: -normal.y, z: -normal.z } : normal
  return { point, normal: outward, part: partIndexAt(surface.parts, point) }
}
