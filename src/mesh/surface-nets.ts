// Naive surface nets over a sample grid: one vertex per cell the surface
// crosses, at the average of its edge crossings, and one quad per grid edge
// the surface cuts. The fewest triangles, closed wherever the surface is
// resolved, but its vertices float up to half a cell off the surface
// (upstream ADR 0003 / 0030). Ported from big-mesh-studios' packages/meshing,
// reduced to the one uniform box the modeller meshes.

import type { MeshBuilder } from "./builder"
import { forEachActiveBlock, forEachActiveCell, gridPoints, type Grid } from "./grid"

// Corner c of a cell sits at (c & 1, c >> 1 & 1, c >> 2 & 1).
const CELL_EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
] as const

const OTHER_AXES = [
  [1, 2],
  [2, 0],
  [0, 1],
] as const

export const surfaceNets = (grid: Grid, out: MeshBuilder): void => {
  let { origin, sampleSize, values } = grid
  let n = gridPoints(grid.samples)
  let cells = n - 1
  let strides = [1, cells, cells * cells]
  let cellVertex = new Int32Array(cells * cells * cells).fill(-1)
  let corners = new Float32Array(8)
  let at = (x: number, y: number, z: number): number => values[(z * n + y) * n + x]!

  forEachActiveCell(grid, (cx, cy, cz) => {
    let inside = 0
    for (let c = 0; c < 8; c++) {
      let value = at(cx + (c & 1), cy + ((c >> 1) & 1), cz + ((c >> 2) & 1))
      corners[c] = value
      if (value < 0) inside++
    }
    if (inside === 0 || inside === 8) return

    let sumX = 0
    let sumY = 0
    let sumZ = 0
    let crossings = 0
    for (let [a, b] of CELL_EDGES) {
      let va = corners[a]!
      let vb = corners[b]!
      if (va < 0 === vb < 0) continue
      let t = va / (va - vb)
      let ax = a & 1
      let ay = (a >> 1) & 1
      let az = (a >> 2) & 1
      sumX += ax + t * ((b & 1) - ax)
      sumY += ay + t * (((b >> 1) & 1) - ay)
      sumZ += az + t * (((b >> 2) & 1) - az)
      crossings++
    }
    cellVertex[(cz * cells + cy) * cells + cx] = out.vertex(
      origin[0] + (cx - 1 + sumX / crossings) * sampleSize,
      origin[1] + (cy - 1 + sumY / crossings) * sampleSize,
      origin[2] + (cz - 1 + sumZ / crossings) * sampleSize,
    )
  })

  // A quad per cut grid edge. The cells around an edge are all crossed, so
  // the point that owns the edge lies in an active block.
  let quad = [0, 0, 0, 0]
  forEachActiveBlock(grid, 1, grid.samples, (px, py, pz) => {
    let base = (pz * cells + py) * cells + px
    let nearInside = at(px, py, pz) < 0
    for (let axis = 0; axis < 3; axis++) {
      let farInside = (axis === 0 ? at(px + 1, py, pz) : axis === 1 ? at(px, py + 1, pz) : at(px, py, pz + 1)) < 0
      if (nearInside === farInside) continue
      let acrossB = strides[OTHER_AXES[axis]![0]]!
      let acrossC = strides[OTHER_AXES[axis]![1]]!
      quad[0] = cellVertex[base - acrossB - acrossC]!
      quad[1] = cellVertex[base - acrossC]!
      quad[2] = cellVertex[base]!
      quad[3] = cellVertex[base - acrossB]!
      if (quad[0] < 0 || quad[1]! < 0 || quad[2]! < 0 || quad[3]! < 0) continue
      // Counter-clockwise seen from outside, so the faces point out.
      if (nearInside) out.quad(quad[0], quad[1]!, quad[2]!, quad[3]!)
      else out.quad(quad[0], quad[3]!, quad[2]!, quad[1]!)
    }
  })
}
