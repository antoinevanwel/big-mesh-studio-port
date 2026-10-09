// Cuts a mesh along its colour boundaries so every triangle carries one
// colour (upstream ADR 0046). A mesh stores colour per vertex and the
// rasteriser blends between them, so a red part meeting a blue one would
// show a purple ramp across every triangle at the seam. Instead, each edge
// whose two ends disagree is bisected against the field to find where the
// colour actually flips, and every triangle with such an edge is re-cut
// there: one region per colour, a fan each. Marching cubes only, because
// only its edges lie on the surface.
//
// A crossing is a pure function of its edge's two endpoints (searched in
// index order), so the two triangles sharing an edge agree on it and the
// mesh stays closed; the report matches edges by position, so the doubled
// seam vertices do not read as holes.

import type { PaintKey } from "../model/field"
import type { MeshData } from "./builder"

export const CROSSING_TOLERANCE = 1e-3
export const CROSSING_MAX_STEPS = 24

/** The edges a triangle is cut on, plus its middle piece, per triangle. */
const SLOTS = 4
const MIDDLE = 3

export const splitColourSeams = (mesh: MeshData, paintAt: (x: number, y: number, z: number) => PaintKey): MeshData => {
  let { positions, normals, paints, indices, vertexCount, triangleCount } = mesh
  let blended = false
  for (let t = 0; t < triangleCount && !blended; t++) {
    let first = paints[indices[t * 3]!]!
    blended = paints[indices[t * 3 + 1]!]! !== first || paints[indices[t * 3 + 2]!]! !== first
  }
  if (!blended) return mesh

  // Find every crossing, once per edge.
  let slots = new Int32Array(triangleCount * SLOTS).fill(-1)
  let byEdge = new Map<number, number>()
  let crossings: number[] = [] // x, y, z, along, low, high per crossing
  let crossingPaints: number[] = [] // low side, high side
  for (let t = 0; t < triangleCount; t++) {
    for (let e = 0; e < 3; e++) {
      let u = indices[t * 3 + e]!
      let v = indices[t * 3 + ((e + 1) % 3)]!
      let low = u < v ? u : v
      let high = u < v ? v : u
      let lowPaint = paints[low]!
      let highPaint = paints[high]!
      if (lowPaint === highPaint) continue
      let key = low * vertexCount + high
      let known = byEdge.get(key)
      if (known !== undefined) {
        slots[t * SLOTS + e] = known
        continue
      }
      let ax = positions[low * 3]!, ay = positions[low * 3 + 1]!, az = positions[low * 3 + 2]!
      let bx = positions[high * 3]!, by = positions[high * 3 + 1]!, bz = positions[high * 3 + 2]!
      if (paintAt(ax, ay, az) !== lowPaint) continue
      let near = 0
      let far = 1
      for (let step = 0; step < CROSSING_MAX_STEPS && far - near > CROSSING_TOLERANCE; step++) {
        let mid = (near + far) / 2
        if (paintAt(ax + (bx - ax) * mid, ay + (by - ay) * mid, az + (bz - az) * mid) === lowPaint) near = mid
        else far = mid
      }
      // Clamped just inside the edge rather than refused, so every
      // disagreeing edge is cut and no triangle is left with one cut edge.
      let along = Math.min(1 - CROSSING_TOLERANCE, Math.max(CROSSING_TOLERANCE, (near + far) / 2))
      let slot = crossingPaints.length / 2
      crossings.push(ax + (bx - ax) * along, ay + (by - ay) * along, az + (bz - az) * along, along, low, high)
      crossingPaints.push(lowPaint, highPaint)
      byEdge.set(key, slot)
      slots[t * SLOTS + e] = slot
    }
  }
  let crossingCount = crossingPaints.length / 2
  if (crossingCount === 0) return mesh

  let middles = 0
  for (let t = 0; t < triangleCount; t++) if (slots[t * SLOTS]! >= 0 && slots[t * SLOTS + 1]! >= 0 && slots[t * SLOTS + 2]! >= 0) middles++

  // Each crossing becomes two vertices at one point, one per colour.
  let base = vertexCount
  let middleBase = base + crossingCount * 2
  let outCount = middleBase + middles * 3
  let outPositions = new Float32Array(outCount * 3)
  let outNormals = new Float32Array(outCount * 3)
  let outPaints = new Uint32Array(outCount)
  outPositions.set(positions)
  outNormals.set(normals)
  outPaints.set(paints)
  for (let s = 0; s < crossingCount; s++) {
    let at = s * 6
    let along = crossings[at + 3]!
    let low = crossings[at + 4]! * 3
    let high = crossings[at + 5]! * 3
    let nx = normals[low]! + (normals[high]! - normals[low]!) * along
    let ny = normals[low + 1]! + (normals[high + 1]! - normals[low + 1]!) * along
    let nz = normals[low + 2]! + (normals[high + 2]! - normals[low + 2]!) * along
    let length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
    for (let side = 0; side < 2; side++) {
      let v = base + s * 2 + side
      outPositions[v * 3] = crossings[at]!
      outPositions[v * 3 + 1] = crossings[at + 1]!
      outPositions[v * 3 + 2] = crossings[at + 2]!
      outNormals[v * 3] = nx / length
      outNormals[v * 3 + 1] = ny / length
      outNormals[v * 3 + 2] = nz / length
      outPaints[v] = crossingPaints[s * 2 + side]!
    }
  }

  // Three cut edges leave an inner triangle no corner region covers; it
  // holds no vertex to read a colour from, so its colour is asked for.
  let next = middleBase
  for (let t = 0; t < triangleCount; t++) {
    if (slots[t * SLOTS]! < 0 || slots[t * SLOTS + 1]! < 0 || slots[t * SLOTS + 2]! < 0) continue
    let cx = 0, cy = 0, cz = 0
    for (let e = 0; e < 3; e++) {
      let v = base + slots[t * SLOTS + e]! * 2
      cx += outPositions[v * 3]!
      cy += outPositions[v * 3 + 1]!
      cz += outPositions[v * 3 + 2]!
    }
    let paint = paintAt(cx / 3, cy / 3, cz / 3)
    for (let e = 0; e < 3; e++) {
      let from = base + slots[t * SLOTS + e]! * 2
      for (let axis = 0; axis < 3; axis++) {
        outPositions[next * 3 + axis] = outPositions[from * 3 + axis]!
        outNormals[next * 3 + axis] = outNormals[from * 3 + axis]!
      }
      outPaints[next] = paint
      next++
    }
    slots[t * SLOTS + MIDDLE] = next - 3
  }

  let copyFor = (slot: number, paint: number): number => (crossingPaints[slot * 2] === paint ? base + slot * 2 : base + slot * 2 + 1)
  let outIndices = new Uint32Array(triangleCount * 12)
  let written = 0
  let here: number[] = []
  let ring: number[] = []
  let corners = [0, 0, 0]
  for (let t = 0; t < triangleCount; t++) {
    corners[0] = indices[t * 3]!
    corners[1] = indices[t * 3 + 1]!
    corners[2] = indices[t * 3 + 2]!
    here.length = 0
    for (let e = 0; e < 3; e++) if (slots[t * SLOTS + e]! >= 0) here.push(e)
    if (here.length === 0) {
      outIndices[written++] = corners[0]
      outIndices[written++] = corners[1]
      outIndices[written++] = corners[2]
      continue
    }
    // One region per arc of the boundary: from the crossing on the edge it
    // enters by, round the corners it holds, to the crossing it leaves by.
    for (let region = 0; region < here.length; region++) {
      let enter = here[region]!
      let leave = here[(region + 1) % here.length]!
      let start = (enter + 1) % 3
      let count = ((((leave - start) % 3) + 3) % 3) + 1
      let paint = paints[corners[(start + count - 1) % 3]!]!
      ring.length = 0
      ring.push(copyFor(slots[t * SLOTS + enter]!, paint))
      for (let step = 0; step < count; step++) ring.push(corners[(start + step) % 3]!)
      ring.push(copyFor(slots[t * SLOTS + leave]!, paint))
      for (let i = 1; i + 1 < ring.length; i++) {
        outIndices[written++] = ring[0]!
        outIndices[written++] = ring[i]!
        outIndices[written++] = ring[i + 1]!
      }
    }
    let middle = slots[t * SLOTS + MIDDLE]!
    if (middle >= 0) {
      outIndices[written++] = middle
      outIndices[written++] = middle + 1
      outIndices[written++] = middle + 2
    }
  }

  return {
    positions: outPositions,
    normals: outNormals,
    paints: outPaints,
    indices: outIndices.slice(0, written),
    vertexCount: outCount,
    triangleCount: written / 3,
  }
}
