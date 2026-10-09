// The arithmetic of the move tool's arrows, in screen space: which arm a
// press lands on, and how far along its axis a drag has gone. Ported from
// upstream's view/move-handle.ts. Pure, so it is tested without a scene.

export interface ScreenPoint {
  readonly x: number
  readonly y: number
}

export type Axis = "x" | "y" | "z"

export const AXES: readonly Axis[] = ["x", "y", "z"]

/** The arrows' length as a share of the camera's distance, so they keep their size on screen. */
export const VIEW_SHARE = 0.25
export const SHAFT_RADIUS = 0.028
export const HEAD_LENGTH = 0.26
export const HEAD_RADIUS = 0.075

/** How close a press must land to an arm, in logical pixels: a fingertip, not a pixel. */
export const GRAB_RADIUS = 22
/** A press this close to the arrows' meeting point is too ambiguous to pick an arm. */
export const HUB_RADIUS = 18
/** An arm drawn shorter than this on screen points into the screen and cannot be dragged along. */
export const TOO_FORESHORTENED = 10

export interface ArmOnScreen {
  readonly axis: Axis
  readonly from: ScreenPoint
  readonly to: ScreenPoint
}

export const distanceToSegment = (point: ScreenPoint, from: ScreenPoint, to: ScreenPoint): number => {
  let runX = to.x - from.x
  let runY = to.y - from.y
  let lengthSquared = runX * runX + runY * runY
  if (lengthSquared === 0) return Math.hypot(point.x - from.x, point.y - from.y)
  let along = Math.max(0, Math.min(1, ((point.x - from.x) * runX + (point.y - from.y) * runY) / lengthSquared))
  return Math.hypot(point.x - (from.x + runX * along), point.y - (from.y + runY * along))
}

/** The arm a press at `pointer` takes hold of, or undefined; `scale` turns the radii into screen units. */
export const armUnderPointer = (pointer: ScreenPoint, arms: readonly ArmOnScreen[], scale = 1): Axis | undefined => {
  let hub = arms[0]
  if (hub !== undefined && Math.hypot(pointer.x - hub.from.x, pointer.y - hub.from.y) < HUB_RADIUS * scale) return undefined
  let closest: { axis: Axis; distance: number } | undefined
  for (let arm of arms) {
    let distance = distanceToSegment(pointer, arm.from, arm.to)
    if (distance <= GRAB_RADIUS * scale && (closest === undefined || distance < closest.distance)) closest = { axis: arm.axis, distance }
  }
  return closest?.axis
}

/**
 * How far along its axis a drag of `dragged` (screen units since the grab)
 * moves a part: the drag projected onto the arm as drawn, as a fraction of
 * the arm, times the arm's world length. Measured from the grab every time,
 * so a drag back to its start puts the part back.
 */
export const distanceDragged = (dragged: ScreenPoint, arm: ArmOnScreen, armLength: number, scale = 1): number => {
  let runX = arm.to.x - arm.from.x
  let runY = arm.to.y - arm.from.y
  let onScreen = Math.hypot(runX, runY)
  if (onScreen < TOO_FORESHORTENED * scale) return 0
  let along = (dragged.x * runX + dragged.y * runY) / onScreen
  return (along / onScreen) * armLength
}
