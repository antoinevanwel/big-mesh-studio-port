import { test, expect } from "flux:test"
import { createRoot, flush } from "@solidrt/core"
import { createModelStore } from "../src/model/model-store"
import { fromEuler, newModel, placedPart, toEuler } from "../src/model/part"
import { hsvaToRgba, rgbaToHsva } from "../src/model/colour"
import { nearestPart } from "../src/model/field"
import { armUnderPointer, distanceDragged, type ArmOnScreen } from "../src/view/move-handle"

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
