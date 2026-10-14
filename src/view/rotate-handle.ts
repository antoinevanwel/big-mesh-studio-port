// The arithmetic of the rotate tool's rings, in screen space: which ring a
// press lands on, and how far round it a drag has gone. Ported from
// upstream's view/rotate-handle.ts. Pure, so it is tested without a scene.
//
// A ring is hit against its drawn outline, walked point by point, rather
// than by a raycast against the thin tube: a finger is far wider than the
// tube, and the ring is as big as it looks. A drag becomes an angle by the
// bearing swept about the ring's middle (the part's origin on screen),
// which is what the eye reads: the finger went a quarter of the way round,
// so the part turned a quarter turn.

import { distanceToSegment, GRAB_RADIUS, type Axis, type ScreenPoint } from "./move-handle"

/** A ring's radius as a share of the camera's distance, so it keeps its size on screen. A little more than the arrows'. */
export const RING_VIEW_SHARE = 0.3
/** How thick a ring is drawn, in units of its own radius. */
export const TUBE_RADIUS = 0.02
/** How many points a ring is measured (and drawn) along. */
export const AROUND = 48

export interface RingOnScreen {
  readonly axis: Axis
  /** The point the ring turns about: the part's origin on screen. */
  readonly middle: ScreenPoint
  /** The ring's outline on screen, in the order it is walked. */
  readonly around: readonly ScreenPoint[]
  /** Whether the ring's axis points towards the viewer; a ring seen from behind turns the other way. */
  readonly facing: boolean
}

/** The ring a press at `pointer` takes hold of, or undefined. The nearest wins where rings cross. */
export const ringUnderPointer = (pointer: ScreenPoint, rings: readonly RingOnScreen[], scale = 1): Axis | undefined => {
  let closest: { axis: Axis; distance: number } | undefined
  for (let ring of rings) {
    for (let i = 0; i < ring.around.length; i++) {
      let distance = distanceToSegment(pointer, ring.around[i]!, ring.around[(i + 1) % ring.around.length]!)
      if (distance <= GRAB_RADIUS * scale && (closest === undefined || distance < closest.distance)) closest = { axis: ring.axis, distance }
    }
  }
  return closest?.axis
}

/**
 * How far round its axis a drag from `from` to `to` (screen units) carries
 * a ring, in radians, positive by the right-hand rule. Measured from the
 * grab every time, so a drag back to its start puts the part back.
 */
export const radiansDragged = (from: ScreenPoint, to: ScreenPoint, ring: RingOnScreen): number => {
  let swept = Math.atan2(to.y - ring.middle.y, to.x - ring.middle.x) - Math.atan2(from.y - ring.middle.y, from.x - ring.middle.x)
  // The screen's y runs down, so a sweep there runs against the world's; a
  // ring whose axis points away runs the other way again.
  return (ring.facing ? -1 : 1) * swept
}
