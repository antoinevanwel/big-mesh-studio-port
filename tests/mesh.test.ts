import { test, expect } from "flux:test"
import { budgetFor, meshParts } from "../src/mesh/mesh-model"
import { newModel, placedPart, fromEuler } from "../src/model/part"
import { Field, packPaint } from "../src/model/field"
import { BLOCK, gridPoints, sampleGrid } from "../src/mesh/grid"
import type { Part } from "../src/model/part"

const capsuleVolume = Math.PI * 0.7 * 0.7 * 2.2 + (4 / 3) * Math.PI * 0.7 ** 3

test("marching cubes closes the default capsule with an outward, accurate volume", () => {
  let result = meshParts(newModel(), budgetFor(0.125), "marching-cubes")!
  expect(result.report.boundaryEdges).toBe(0)
  expect(result.report.nonManifoldEdges).toBe(0)
  expect(result.report.inconsistentEdges).toBe(0)
  expect(result.report.watertight).toBe(true)
  expect(Math.abs(result.report.volume - capsuleVolume) / capsuleVolume).toBeLessThan(0.03)
})

test("surface nets closes the default capsule with an outward volume", () => {
  let result = meshParts(newModel(), budgetFor(0.125), "surface-nets")!
  expect(result.report.boundaryEdges).toBe(0)
  expect(result.report.inconsistentEdges).toBe(0)
  expect(result.report.volume).toBeGreaterThan(capsuleVolume * 0.9)
  expect(result.report.volume).toBeLessThan(capsuleVolume * 1.1)
})

test("a subtraction removes material", () => {
  let solid = meshParts([placedPart("a", { type: "Box", len: { x: 1, y: 1, z: 1 } }, { x: 0, y: 0, z: 0 })], budgetFor(0.125))!
  let cut = meshParts(
    [
      placedPart("a", { type: "Box", len: { x: 1, y: 1, z: 1 } }, { x: 0, y: 0, z: 0 }),
      placedPart("b", { type: "Sphere", radius: 0.6 }, { x: 1, y: 0, z: 0 }, { combine: "Subtract" }),
    ],
    budgetFor(0.125),
  )!
  expect(solid.report.volume).toBeCloseTo(8, 1)
  expect(cut.report.watertight).toBe(true)
  expect(cut.report.volume).toBeCloseTo(solid.report.volume - (2 / 3) * Math.PI * 0.6 ** 3, 1)
})

test("a rotated capsule lies along the rotated axis", () => {
  let lying = meshParts([placedPart("a", { type: "Capsule", len: 2, radius: 0.3 }, { x: 0, y: 0, z: 0 }, { orientation: fromEuler(0, 0, Math.PI / 2) })], budgetFor(0.125))!
  let { positions, vertexCount } = lying.mesh
  let spanX = 0
  let spanY = 0
  for (let v = 0; v < vertexCount; v++) {
    spanX = Math.max(spanX, Math.abs(positions[v * 3]!))
    spanY = Math.max(spanY, Math.abs(positions[v * 3 + 1]!))
  }
  expect(spanX).toBeGreaterThan(1.2)
  expect(spanY).toBeLessThan(0.4)
})

test("two coloured parts keep two colours and no triangle blends between them", () => {
  let red = { r: 214, g: 96, b: 84 }
  let blue = { r: 96, g: 150, b: 214 }
  let result = meshParts(
    [
      placedPart("a", { type: "Sphere", radius: 0.7 }, { x: 0, y: 0, z: 0 }, { colour: red }),
      placedPart("b", { type: "Box", len: { x: 0.5, y: 0.5, z: 0.5 } }, { x: 0.9, y: 0, z: 0 }, { colour: blue }),
    ],
    budgetFor(0.125),
  )!
  let { paints, indices, triangleCount } = result.mesh
  let seen = new Set<number>()
  let blended = 0
  for (let t = 0; t < triangleCount; t++) {
    let a = paints[indices[t * 3]!]!
    seen.add(a)
    if (paints[indices[t * 3 + 1]!] !== a || paints[indices[t * 3 + 2]!] !== a) blended++
  }
  expect(blended).toBe(0)
  expect(seen.size).toBe(2)
  expect(seen.has(packPaint(red, 1))).toBe(true)
  expect(seen.has(packPaint(blue, 1))).toBe(true)
  expect(result.report.boundaryEdges).toBe(0)
})

test("every primitive meshes closed", () => {
  let shapes = [
    { type: "Sphere", radius: 0.5 },
    { type: "Ellipsoid", radius: { x: 0.7, y: 0.5, z: 0.4 } },
    { type: "Box", len: { x: 0.6, y: 0.6, z: 0.6 } },
    { type: "RoundBox", len: { x: 0.5, y: 0.5, z: 0.5 }, radius: 0.15 },
    { type: "Capsule", len: 1.2, radius: 0.35 },
    { type: "Cone", len: 1, radius: 0.5 },
    { type: "Cylinder", len: 1, radius: 0.4 },
    { type: "Torus", majorRadius: 0.6, minorRadius: 0.2 },
    { type: "HexPrism", len: 1, radius: 0.5 },
  ] as const
  for (let shape of shapes) {
    let result = meshParts([placedPart(shape.type, shape, { x: 0, y: 0, z: 0 })], budgetFor(0.125))!
    expect({ type: shape.type, open: result.report.boundaryEdges, positive: result.report.volume > 0 }).toEqual({ type: shape.type, open: 0, positive: true })
  }
})

// Every cell the exact field crosses must sit in a block the cull kept, or
// the mesh has a hole there. Soft blends are where that can fail: a blend
// dents the field by up to its softness, so a block's centre value can claim
// more distance from the surface than there is.
const crossedCellsCulled = (parts: Part[], sampleSize: number): number => {
  let field = new Field(parts)
  let samples = 40
  let origin: [number, number, number] = [-samples * sampleSize * 0.5, -samples * sampleSize * 0.5, -samples * sampleSize * 0.5]
  let grid = sampleGrid(field, origin, samples, sampleSize)
  let n = gridPoints(samples)
  let exact = new Float32Array(n * n * n)
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) exact[(z * n + y) * n + x] = field.distance(origin[0] + (x - 1) * sampleSize, origin[1] + (y - 1) * sampleSize, origin[2] + (z - 1) * sampleSize)
  let missed = 0
  for (let z = 0; z < n - 1; z++)
    for (let y = 0; y < n - 1; y++)
      for (let x = 0; x < n - 1; x++) {
        let inside = 0
        for (let c = 0; c < 8; c++) if (exact[((z + (c >> 2)) * n + y + ((c >> 1) & 1)) * n + x + (c & 1)]! < 0) inside++
        if (inside === 0 || inside === 8) continue
        let b = (Math.floor(z / BLOCK) * grid.blocks + Math.floor(y / BLOCK)) * grid.blocks + Math.floor(x / BLOCK)
        if (grid.active[b] === 0) missed++
      }
  return missed
}

test("the block cull keeps every block a soft blend's surface crosses", () => {
  let soft = 0.25
  let models: Part[][] = [
    [
      placedPart("a", { type: "Sphere", radius: 0.5 }, { x: -0.45, y: 0, z: 0 }),
      placedPart("b", { type: "Sphere", radius: 0.5 }, { x: 0.45, y: 0, z: 0 }, { softness: soft }),
    ],
    [
      placedPart("a", { type: "Box", len: { x: 1.4, y: 1.4, z: 1.4 } }, { x: 0, y: 0, z: 0 }),
      placedPart("b", { type: "Sphere", radius: 0.6 }, { x: 0.7, y: 0.7, z: 0 }, { combine: "Subtract", softness: soft }),
    ],
    [
      placedPart("a", { type: "Capsule", len: 1.4, radius: 0.25 }, { x: 0, y: 0, z: 0 }),
      placedPart("b", { type: "Torus", majorRadius: 0.6, minorRadius: 0.12 }, { x: 0, y: 0.1, z: 0 }, { softness: soft }),
      placedPart("c", { type: "Sphere", radius: 0.3 }, { x: 0.3, y: 0.5, z: 0.2 }, { softness: soft }),
    ],
  ]
  for (let parts of models) for (let size of [0.05, 0.08, 0.12]) expect(crossedCellsCulled(parts, size)).toBe(0)
})
