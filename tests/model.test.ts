import { test, expect } from "flux:test"
import { createRoot, flush } from "@solidrt/core"
import { createModelStore } from "../src/model/model-store"
import { axisAngle, fromEuler, IDENTITY, multiply, newModel, placedPart, toEuler } from "../src/model/part"
import { hsvaToRgba, rgbaToHsva } from "../src/model/colour"
import { nearestPart } from "../src/model/field"
import { armUnderPointer, distanceDragged, type ArmOnScreen } from "../src/view/move-handle"
import { radiansDragged, ringUnderPointer, type RingOnScreen } from "../src/view/rotate-handle"

const sphere = (id: string, x = 0) => placedPart(id, { type: "Sphere", radius: 0.5 }, { x, y: 0, z: 0 })

// The store is made in an owner, as a component makes it, and edited from
// outside one, as an event handler edits it.
const storeOf = (parts: Parameters<typeof createModelStore>[0] = []) => createRoot(() => createModelStore(parts))

test("undo and redo walk the history in both directions", () => {
  let store = storeOf(newModel())
  store.add(sphere("a"))
  store.change("a", { origin: { x: 1, y: 2, z: 3 }, colour: { r: 1, g: 2, b: 3 } })
  flush()
  expect(store.part("a")!.origin).toEqual({ x: 1, y: 2, z: 3 })
  store.undo()
  flush()
  expect(store.part("a")!.origin).toEqual({ x: 0, y: 0, z: 0 })
  expect(store.part("a")!.colour).toBe(undefined)
  store.redo()
  flush()
  // Upstream's redo replayed only the transform; every changed field comes back here.
  expect(store.part("a")!.colour).toEqual({ r: 1, g: 2, b: 3 })
  store.undo()
  store.undo()
  flush()
  expect(store.parts().map(part => part.id)).toEqual(["body"])
  expect(store.canRedo()).toBe(true)
})

test("a removed part comes back where it was", () => {
  let store = storeOf([sphere("a"), sphere("b"), sphere("c")])
  store.select("b")
  store.remove("b")
  flush()
  expect(store.parts().map(part => part.id)).toEqual(["a", "c"])
  expect(store.selected()).toBe(undefined)
  store.undo()
  flush()
  expect(store.parts().map(part => part.id)).toEqual(["a", "b", "c"])
  expect(store.selected()).toBe("b")
})

test("changes in one gesture are one undo step", () => {
  let store = storeOf([sphere("a")])
  let gesture = {}
  store.change("a", { colour: { r: 10, g: 0, b: 0 }, opacity: 1 }, gesture)
  store.change("a", { colour: { r: 20, g: 0, b: 0 }, opacity: 0.5 }, gesture)
  store.change("a", { colour: { r: 30, g: 0, b: 0 }, opacity: 0.5 }, gesture)
  flush()
  store.undo()
  flush()
  expect(store.part("a")!.colour).toBe(undefined)
  expect(store.part("a")!.opacity).toBe(undefined)
  expect(store.canUndo()).toBe(false)
  store.redo()
  flush()
  expect(store.part("a")!.colour).toEqual({ r: 30, g: 0, b: 0 })
  expect(store.part("a")!.opacity).toBe(0.5)
})

test("a duplicate lands on the original under a fresh id, selected, and undoes away", () => {
  let store = storeOf([sphere("a", 2)])
  store.change("a", { colour: { r: 9, g: 8, b: 7 }, opacity: 0.5 })
  let copy = store.duplicate("a")
  flush()
  expect(copy).toBe("part-1")
  expect(store.selected()).toBe("part-1")
  expect(store.part("part-1")!.origin).toEqual({ x: 2, y: 0, z: 0 })
  expect(store.part("part-1")!.colour).toEqual({ r: 9, g: 8, b: 7 })
  expect(store.duplicate("missing")).toBe(undefined)
  store.undo()
  flush()
  expect(store.parts().map(part => part.id)).toEqual(["a"])
})

test("moving a part up and down the list is undoable, and refused at the ends", () => {
  let store = storeOf([sphere("a"), sphere("b"), sphere("c")])
  expect(store.moveUp("a")).toBe(false)
  expect(store.moveDown("c")).toBe(false)
  expect(store.canUndo()).toBe(false)
  store.moveDown("a")
  store.moveDown("a")
  flush()
  expect(store.parts().map(part => part.id)).toEqual(["b", "c", "a"])
  store.undo()
  flush()
  expect(store.parts().map(part => part.id)).toEqual(["b", "a", "c"])
  store.moveUp("c")
  flush()
  expect(store.parts().map(part => part.id)).toEqual(["b", "c", "a"])
})

test("an unchanged edit records nothing", () => {
  let store = storeOf([sphere("a")])
  expect(store.change("a", { origin: { x: 0, y: 0, z: 0 } })).toBe(false)
  flush()
  expect(store.canUndo()).toBe(false)
})

test("ids are never handed out twice, even past loaded ones", () => {
  let store = storeOf()
  store.load([sphere("part-1"), sphere("part-2")], "open")
  expect(store.nextId()).toBe("part-3")
  expect(store.load([sphere("x"), sphere("x")], "bad")).toBe(false)
})

test("Euler angles survive the quaternion round trip", () => {
  let angles = toEuler(fromEuler((30 * Math.PI) / 180, (20 * Math.PI) / 180, (-45 * Math.PI) / 180))
  expect(angles.yaw).toBeCloseTo(30, 6)
  expect(angles.pitch).toBeCloseTo(20, 6)
  expect(angles.roll).toBeCloseTo(-45, 6)
})

test("a grey keeps the hue it was dragged from", () => {
  let previous = { h: 200, s: 0.8, v: 0.9, a: 1 }
  let grey = rgbaToHsva({ r: 0, g: 0, b: 0, a: 255 }, previous)
  expect(grey.h).toBe(200)
  expect(grey.s).toBe(0.8)
  expect(hsvaToRgba({ h: 120, s: 1, v: 1, a: 1 })).toEqual({ r: 0, g: 255, b: 0, a: 255 })
})

test("a picked point selects the part whose surface it lies on", () => {
  let parts = [sphere("left", -2), sphere("right", 2)]
  expect(nearestPart(parts, 1.5, 0, 0)!.id).toBe("right")
  expect(nearestPart(parts, -2, 0.5, 0)!.id).toBe("left")
})

test("an arm is grabbed within a fingertip and dragged along its own screen length", () => {
  let arms: ArmOnScreen[] = [
  { axis: "x", from: { x: 100, y: 100 }, to: { x: 200, y: 100 } },
  { axis: "y", from: { x: 100, y: 100 }, to: { x: 100, y: 0 } },
  ]
  expect(armUnderPointer({ x: 150, y: 110 }, arms)).toBe("x")
  expect(armUnderPointer({ x: 105, y: 50 }, arms)).toBe("y")
  expect(armUnderPointer({ x: 102, y: 102 }, arms)).toBe(undefined) // the hub is ambiguous
  expect(armUnderPointer({ x: 150, y: 160 }, arms)).toBe(undefined)
  expect(distanceDragged({ x: 50, y: 30 }, arms[0]!, 2)).toBeCloseTo(1, 6)
  expect(distanceDragged({ x: 0, y: -100 }, arms[1]!, 2)).toBeCloseTo(2, 6)
})

// A ring of radius 100 around (200, 200), walked counter-clockwise on screen.
const circle = (axis: "x" | "y" | "z", radius: number, facing: boolean): RingOnScreen => ({
  axis,
  middle: { x: 200, y: 200 },
  around: Array.from({ length: 48 }, (_, i) => ({ x: 200 + radius * Math.cos((i / 48) * 2 * Math.PI), y: 200 + radius * Math.sin((i / 48) * 2 * Math.PI) })),
  facing,
})

test("a ring is grabbed on its outline, the nearest where two cross", () => {
  let rings = [circle("x", 100, true), circle("z", 60, true)]
  expect(ringUnderPointer({ x: 305, y: 200 }, rings)).toBe("x")
  expect(ringUnderPointer({ x: 262, y: 200 }, rings)).toBe("z")
  expect(ringUnderPointer({ x: 200, y: 200 }, rings)).toBe(undefined)
  expect(ringUnderPointer({ x: 340, y: 200 }, rings)).toBe(undefined)
})

test("a drag a quarter round a ring is a quarter turn, the way the finger went", () => {
  // From the right of the middle to below it: clockwise on a y-down screen.
  let towards = radiansDragged({ x: 300, y: 200 }, { x: 200, y: 300 }, circle("z", 100, true))
  let away = radiansDragged({ x: 300, y: 200 }, { x: 200, y: 300 }, circle("z", 100, false))
  expect(Math.abs(towards + Math.PI / 2)).toBeLessThan(1e-9)
  expect(Math.abs(away - Math.PI / 2)).toBeLessThan(1e-9)
  expect(Math.abs(radiansDragged({ x: 300, y: 200 }, { x: 300, y: 200 }, circle("z", 100, true)))).toBe(0)
})

test("a turn about a world axis composes before the part's own", () => {
  // A part laid on its side (a quarter turn about z), then turned about world y.
  let laid = axisAngle(0, 0, 1, Math.PI / 2)
  let turned = multiply(axisAngle(0, 1, 0, Math.PI / 2), laid)
  // Its own +y axis (pointing along world -x once laid) now points along world +z.
  let q = turned
  let v = { x: 0, y: 1, z: 0 }
  let tx = 2 * (q.y * v.z - q.z * v.y)
  let ty = 2 * (q.z * v.x - q.x * v.z)
  let tz = 2 * (q.x * v.y - q.y * v.x)
  let out = { x: v.x + q.w * tx + (q.y * tz - q.z * ty), y: v.y + q.w * ty + (q.z * tx - q.x * tz), z: v.z + q.w * tz + (q.x * ty - q.y * tx) }
  expect(Math.abs(out.x)).toBeLessThan(1e-9)
  expect(Math.abs(out.y)).toBeLessThan(1e-9)
  expect(Math.abs(out.z - 1)).toBeLessThan(1e-9)
  expect(multiply(IDENTITY, laid)).toEqual(laid)
})
