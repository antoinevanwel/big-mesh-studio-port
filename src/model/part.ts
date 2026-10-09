// The model: a flat list of placed primitives, folded in list order. Each
// part unions with or cuts into everything before it, so the order is part
// of what the model is once a Subtract is in the list. No hierarchy, no
// pivots, no motions (upstream ADR 0027).

import { primitiveHalfExtents, type OperationShape } from "./primitives"
import type { Quat, Rgb8, Vec3 } from "./types"

export type Combine = "Add" | "Subtract"

/** A primitive placed in the model. */
export interface Part {
  /** Unique within the model and never reused, even after a delete. */
  readonly id: string
  readonly shape: OperationShape
  /** The primitive's own origin, in world units. */
  readonly origin: Vec3
  /** Which way the primitive's own axes point. Identity is unrotated. */
  readonly orientation: Quat
  /** How this part joins the ones before it: `Add` unions, `Subtract` cuts. */
  readonly combine: Combine
  /** How far the boolean blends, in world units; zero is a hard edge. */
  readonly softness: number
  /**
   * The colour this part paints the surface nearest it, or undefined for a
   * part with no say in appearance (a cut then takes the colour around it).
   */
  readonly colour?: Rgb8
  /** How opaque the part is, 0..1. Only read where `colour` is set. */
  readonly opacity?: number
}

/** The largest softness the fold supports (upstream's candidate cache bound). */
export const MAX_SOFTNESS = 0.25

export const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 }

/** Euler angles in radians, composed Y then X then Z, what the panel shows. */
export const fromEuler = (yaw: number, pitch: number, roll: number): Quat => {
  let cy = Math.cos(yaw / 2)
  let sy = Math.sin(yaw / 2)
  let cp = Math.cos(pitch / 2)
  let sp = Math.sin(pitch / 2)
  let cr = Math.cos(roll / 2)
  let sr = Math.sin(roll / 2)
  return {
    x: sp * cy * cr + cp * sy * sr,
    y: cp * sy * cr - sp * cy * sr,
    z: cp * cy * sr - sp * sy * cr,
    w: cp * cy * cr + sp * sy * sr,
  }
}

/**
 * The quaternion as the three angles the panel shows, in degrees. Read out
 * of the quaternion on every render rather than stored beside it, so the
 * number on screen is always the number in the model.
 */
export const toEuler = (q: Quat): { yaw: number; pitch: number; roll: number } => {
  // Clamped: asin a hair outside [-1, 1] is NaN, and NaN blanks a field.
  let sinPitch = 2 * (q.w * q.x - q.y * q.z)
  let pitch = Math.asin(Math.max(-1, Math.min(1, sinPitch)))
  let yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.x * q.x + q.y * q.y))
  let roll = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.x * q.x + q.z * q.z))
  let degrees = (radians: number) => (radians * 180) / Math.PI
  return { yaw: degrees(yaw), pitch: degrees(pitch), roll: degrees(roll) }
}

/** The largest distance from a part's origin to any point of it, whatever its rotation. */
export const partHalfDiagonal = (part: Part): number => {
  let half = primitiveHalfExtents(part.shape)
  return Math.hypot(half.x, half.y, half.z)
}

/** The axis-aligned bounds of a model, or undefined when it has no parts. */
export const modelBounds = (parts: readonly Part[], padding = 0): { min: Vec3; max: Vec3 } | undefined => {
  if (parts.length === 0) return undefined
  let min = { x: Infinity, y: Infinity, z: Infinity }
  let max = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (let part of parts) {
    let reach = partHalfDiagonal(part) + padding
    min.x = Math.min(min.x, part.origin.x - reach)
    min.y = Math.min(min.y, part.origin.y - reach)
    min.z = Math.min(min.z, part.origin.z - reach)
    max.x = Math.max(max.x, part.origin.x + reach)
    max.y = Math.max(max.y, part.origin.y + reach)
    max.z = Math.max(max.z, part.origin.z + reach)
  }
  return { min, max }
}

/** A part that unions with a hard edge and no rotation unless told otherwise. */
export const placedPart = (
  id: string,
  shape: OperationShape,
  origin: Vec3,
  overrides: { orientation?: Quat; combine?: Combine; softness?: number; colour?: Rgb8; opacity?: number } = {},
): Part => ({
  id,
  shape,
  origin,
  orientation: overrides.orientation ?? IDENTITY,
  combine: overrides.combine ?? "Add",
  softness: overrides.softness ?? 0,
  ...(overrides.colour === undefined ? {} : { colour: overrides.colour, opacity: overrides.opacity ?? 1 }),
})

/**
 * The model a new document starts from: one capsule, the smallest thing
 * that reads as a figure, rather than an empty canvas that says nothing.
 */
export const newModel = (): Part[] => [placedPart("body", { type: "Capsule", len: 2.2, radius: 0.7 }, { x: 0, y: 1.1, z: 0 })]
