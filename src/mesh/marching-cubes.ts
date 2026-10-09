// Classic marching cubes (Lorensen-Bourke table) over a sample grid. Every
// vertex sits on a true crossing of the surface, so the mesh follows the
// model closely, closes at every resolution (the table is watertight; its
// ambiguous faces can only cost topology, not closure), and its edges run
// along the surface, which is what lets colour seams be cut along them
// (upstream ADR 0030 / 0046). Ported from big-mesh-studios' packages/meshing.

import type { MeshBuilder } from "./builder"
import { forEachActiveCell, gridPoints, type Grid } from "./grid"

// Lorensen-Bourke corner numbering, which the table is written against.
const CORNERS = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
] as const

const EDGE_CORNERS = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
] as const

/** Which axis edge `e` runs along: the z faces' edges alternate x and y, the rest are z. */
const edgeAxis = (edge: number): number => (edge < 8 ? edge & 1 : 2)

/** Which edges a corner pattern cuts, as a bit per edge. */
const EDGE_MASK: Int32Array = (() => {
  let masks = new Int32Array(256)
  for (let pattern = 0; pattern < 256; pattern++) {
    let mask = 0
    for (let edge = 0; edge < 12; edge++) {
      let [a, b] = EDGE_CORNERS[edge]!
      if (((pattern >> a) & 1) !== ((pattern >> b) & 1)) mask |= 1 << edge
    }
    masks[pattern] = mask
  }
  return masks
})()

// One row per corner pattern: the edges each triangle's corners lie on.
const TRI_TABLE_SOURCE = [
  "",
  "0 8 3",
  "0 1 9",
  "1 8 3 9 8 1",
  "1 2 10",
  "0 8 3 1 2 10",
  "9 2 10 0 2 9",
  "2 8 3 2 10 8 10 9 8",
  "3 11 2",
  "0 11 2 8 11 0",
  "1 9 0 2 3 11",
  "1 11 2 1 9 11 9 8 11",
  "3 10 1 11 10 3",
  "0 10 1 0 8 10 8 11 10",
  "3 9 0 3 11 9 11 10 9",
  "9 8 10 10 8 11",
  "4 7 8",
  "4 3 0 7 3 4",
  "0 1 9 8 4 7",
  "4 1 9 4 7 1 7 3 1",
  "1 2 10 8 4 7",
  "3 4 7 3 0 4 1 2 10",
  "9 2 10 9 0 2 8 4 7",
  "2 10 9 2 9 7 2 7 3 7 9 4",
  "8 4 7 3 11 2",
  "11 4 7 11 2 4 2 0 4",
  "9 0 1 8 4 7 2 3 11",
  "4 7 11 9 4 11 9 11 2 9 2 1",
  "3 10 1 3 11 10 7 8 4",
  "1 11 10 1 4 11 1 0 4 7 11 4",
  "4 7 8 9 0 11 9 11 10 11 0 3",
  "4 7 11 4 11 9 9 11 10",
  "9 5 4",
  "9 5 4 0 8 3",
  "0 5 4 1 5 0",
  "8 5 4 8 3 5 3 1 5",
  "1 2 10 9 5 4",
  "3 0 8 1 2 10 4 9 5",
  "5 2 10 5 4 2 4 0 2",
  "2 10 5 3 2 5 3 5 4 3 4 8",
  "9 5 4 2 3 11",
  "0 11 2 0 8 11 4 9 5",
  "0 5 4 0 1 5 2 3 11",
  "2 1 5 2 5 8 2 8 11 4 8 5",
  "10 3 11 10 1 3 9 5 4",
  "4 9 5 0 8 1 8 10 1 8 11 10",
  "5 4 0 5 0 11 5 11 10 11 0 3",
  "5 4 8 5 8 10 10 8 11",
  "9 7 8 5 7 9",
  "9 3 0 9 5 3 5 7 3",
  "0 7 8 0 1 7 1 5 7",
  "1 5 3 3 5 7",
  "9 7 8 9 5 7 10 1 2",
  "10 1 2 9 5 0 5 3 0 5 7 3",
  "8 0 2 8 2 5 8 5 7 10 5 2",
  "2 10 5 2 5 3 3 5 7",
  "7 9 5 7 8 9 3 11 2",
  "9 5 7 9 7 2 9 2 0 2 7 11",
  "2 3 11 0 1 8 1 7 8 1 5 7",
  "11 2 1 11 1 7 7 1 5",
  "9 5 8 8 5 7 10 1 3 10 3 11",
  "5 7 0 5 0 9 7 11 0 1 0 10 11 10 0",
  "11 10 0 11 0 3 10 5 0 8 0 7 5 7 0",
  "11 10 5 7 11 5",
  "10 6 5",
  "0 8 3 5 10 6",
  "9 0 1 5 10 6",
  "1 8 3 1 9 8 5 10 6",
  "1 6 5 2 6 1",
  "1 6 5 1 2 6 3 0 8",
  "9 6 5 9 0 6 0 2 6",
  "5 9 8 5 8 2 5 2 6 3 2 8",
  "2 3 11 10 6 5",
  "11 0 8 11 2 0 10 6 5",
  "0 1 9 2 3 11 5 10 6",
  "5 10 6 1 9 2 9 11 2 9 8 11",
  "6 3 11 6 5 3 5 1 3",
  "0 8 11 0 11 5 0 5 1 5 11 6",
  "3 11 6 0 3 6 0 6 5 0 5 9",
  "6 5 9 6 9 11 11 9 8",
  "5 10 6 4 7 8",
  "4 3 0 4 7 3 6 5 10",
  "1 9 0 5 10 6 8 4 7",
  "10 6 5 1 9 7 1 7 3 7 9 4",
  "6 1 2 6 5 1 4 7 8",
  "1 2 5 5 2 6 3 0 4 3 4 7",
  "8 4 7 9 0 5 0 6 5 0 2 6",
  "7 3 9 7 9 4 3 2 9 5 9 6 2 6 9",
  "3 11 2 7 8 4 10 6 5",
  "5 10 6 4 7 2 4 2 0 2 7 11",
  "0 1 9 4 7 8 2 3 11 5 10 6",
  "9 2 1 9 11 2 9 4 11 7 11 4 5 10 6",
  "8 4 7 3 11 5 3 5 1 5 11 6",
  "5 1 11 5 11 6 1 0 11 7 11 4 0 4 11",
  "0 5 9 0 6 5 0 3 6 11 6 3 8 4 7",
  "6 5 9 6 9 11 4 7 9 7 11 9",
  "10 4 9 6 4 10",
  "4 10 6 4 9 10 0 8 3",
  "10 0 1 10 6 0 6 4 0",
  "8 3 1 8 1 6 8 6 4 6 1 10",
  "1 4 9 1 2 4 2 6 4",
  "3 0 8 1 2 9 2 4 9 2 6 4",
  "0 2 4 4 2 6",
  "8 3 2 8 2 4 4 2 6",
  "10 4 9 10 6 4 11 2 3",
  "0 8 2 2 8 11 4 9 10 4 10 6",
  "3 11 2 0 1 6 0 6 4 6 1 10",
  "6 4 1 6 1 10 4 8 1 2 1 11 8 11 1",
  "9 6 4 9 3 6 9 1 3 11 6 3",
  "8 11 1 8 1 0 11 6 1 9 1 4 6 4 1",
  "3 11 6 3 6 0 0 6 4",
  "6 4 8 11 6 8",
  "7 10 6 7 8 10 8 9 10",
  "0 7 3 0 10 7 0 9 10 6 7 10",
  "10 6 7 1 10 7 1 7 8 1 8 0",
  "10 6 7 10 7 1 1 7 3",
  "1 2 6 1 6 8 1 8 9 8 6 7",
  "2 6 9 2 9 1 6 7 9 0 9 3 7 3 9",
  "7 8 0 7 0 6 6 0 2",
  "7 3 2 6 7 2",
  "2 3 11 10 6 8 10 8 9 8 6 7",
  "2 0 7 2 7 11 0 9 7 6 7 10 9 10 7",
  "1 8 0 1 7 8 1 10 7 6 7 10 2 3 11",
  "11 2 1 11 1 7 10 6 1 6 7 1",
  "8 9 6 8 6 7 9 1 6 11 6 3 1 3 6",
  "0 9 1 11 6 7",
  "7 8 0 7 0 6 3 11 0 11 6 0",
  "7 11 6",
  "7 6 11",
  "3 0 8 11 7 6",
  "0 1 9 11 7 6",
  "8 1 9 8 3 1 11 7 6",
  "10 1 2 6 11 7",
  "1 2 10 3 0 8 6 11 7",
  "2 9 0 2 10 9 6 11 7",
  "6 11 7 2 10 3 10 8 3 10 9 8",
  "7 2 3 6 2 7",
  "7 0 8 7 6 0 6 2 0",
  "2 7 6 2 3 7 0 1 9",
  "1 6 2 1 8 6 1 9 8 8 7 6",
  "10 7 6 10 1 7 1 3 7",
  "10 7 6 1 7 10 1 8 7 1 0 8",
  "0 3 7 0 7 10 0 10 9 6 10 7",
  "7 6 10 7 10 8 8 10 9",
  "6 8 4 11 8 6",
  "3 6 11 3 0 6 0 4 6",
  "8 6 11 8 4 6 9 0 1",
  "9 4 6 9 6 3 9 3 1 11 3 6",
  "6 8 4 6 11 8 2 10 1",
  "1 2 10 3 0 11 0 6 11 0 4 6",
  "4 11 8 4 6 11 0 2 9 2 10 9",
  "10 9 3 10 3 2 9 4 3 11 3 6 4 6 3",
  "8 2 3 8 4 2 4 6 2",
  "0 4 2 4 6 2",
  "1 9 0 2 3 4 2 4 6 4 3 8",
  "1 9 4 1 4 2 2 4 6",
  "8 1 3 8 6 1 8 4 6 6 10 1",
  "10 1 0 10 0 6 6 0 4",
  "4 6 3 4 3 8 6 10 3 0 3 9 10 9 3",
  "10 9 4 6 10 4",
  "4 9 5 7 6 11",
  "0 8 3 4 9 5 11 7 6",
  "5 0 1 5 4 0 7 6 11",
  "11 7 6 8 3 4 3 5 4 3 1 5",
  "9 5 4 10 1 2 7 6 11",
  "6 11 7 1 2 10 0 8 3 4 9 5",
  "7 6 11 5 4 10 4 2 10 4 0 2",
  "3 4 8 3 5 4 3 2 5 10 5 2 11 7 6",
  "7 2 3 7 6 2 5 4 9",
  "9 5 4 0 8 6 0 6 2 6 8 7",
  "3 6 2 3 7 6 1 5 0 5 4 0",
  "6 2 8 6 8 7 2 1 8 4 8 5 1 5 8",
  "9 5 4 10 1 6 1 7 6 1 3 7",
  "1 6 10 1 7 6 1 0 7 8 7 0 9 5 4",
  "4 0 10 4 10 5 0 3 10 6 10 7 3 7 10",
  "7 6 10 7 10 8 5 4 10 4 8 10",
  "6 9 5 6 11 9 11 8 9",
  "3 6 11 0 6 3 0 5 6 0 9 5",
  "0 11 8 0 5 11 0 1 5 5 6 11",
  "6 11 3 6 3 5 5 3 1",
  "1 2 10 9 5 11 9 11 8 11 5 6",
  "0 11 3 0 6 11 0 9 6 5 6 9 1 2 10",
  "11 8 5 11 5 6 8 0 5 10 5 2 0 2 5",
  "6 11 3 6 3 5 2 10 3 10 5 3",
  "5 8 9 5 2 8 5 6 2 3 8 2",
  "9 5 6 9 6 0 0 6 2",
  "1 5 8 1 8 0 5 6 8 3 8 2 6 2 8",
  "1 5 6 2 1 6",
  "1 3 6 1 6 10 3 8 6 5 6 9 8 9 6",
  "10 1 0 10 0 6 9 5 0 5 6 0",
  "0 3 8 5 6 10",
  "10 5 6",
  "11 5 10 7 5 11",
  "11 5 10 11 7 5 8 3 0",
  "5 11 7 5 10 11 1 9 0",
  "10 7 5 10 11 7 9 8 1 8 3 1",
  "11 1 2 11 7 1 7 5 1",
  "0 8 3 1 2 7 1 7 5 7 2 11",
  "9 7 5 9 2 7 9 0 2 2 11 7",
  "7 5 2 7 2 11 5 9 2 3 2 8 9 8 2",
  "2 5 10 2 3 5 3 7 5",
  "8 2 0 8 5 2 8 7 5 10 2 5",
  "9 0 1 5 10 3 5 3 7 3 10 2",
  "9 8 2 9 2 1 8 7 2 10 2 5 7 5 2",
  "1 3 5 3 7 5",
  "0 8 7 0 7 1 1 7 5",
  "9 0 3 9 3 5 5 3 7",
  "9 8 7 5 9 7",
  "5 8 4 5 10 8 10 11 8",
  "5 0 4 5 11 0 5 10 11 11 3 0",
  "0 1 9 8 4 10 8 10 11 10 4 5",
  "10 11 4 10 4 5 11 3 4 9 4 1 3 1 4",
  "2 5 1 2 8 5 2 11 8 4 5 8",
  "0 4 11 0 11 3 4 5 11 2 11 1 5 1 11",
  "0 2 5 0 5 9 2 11 5 4 5 8 11 8 5",
  "9 4 5 2 11 3",
  "2 5 10 3 5 2 3 4 5 3 8 4",
  "5 10 2 5 2 4 4 2 0",
  "3 10 2 3 5 10 3 8 5 4 5 8 0 1 9",
  "5 10 2 5 2 4 1 9 2 9 4 2",
  "8 4 5 8 5 3 3 5 1",
  "0 4 5 1 0 5",
  "8 4 5 8 5 3 9 0 5 0 3 5",
  "9 4 5",
  "4 11 7 4 9 11 9 10 11",
  "0 8 3 4 9 7 9 11 7 9 10 11",
  "1 10 11 1 11 4 1 4 0 7 4 11",
  "3 1 4 3 4 8 1 10 4 7 4 11 10 11 4",
  "4 11 7 9 11 4 9 2 11 9 1 2",
  "9 7 4 9 11 7 9 1 11 2 11 1 0 8 3",
  "11 7 4 11 4 2 2 4 0",
  "11 7 4 11 4 2 8 3 4 3 2 4",
  "2 9 10 2 7 9 2 3 7 7 4 9",
  "9 10 7 9 7 4 10 2 7 8 7 0 2 0 7",
  "3 7 10 3 10 2 7 4 10 1 10 0 4 0 10",
  "1 10 2 8 7 4",
  "4 9 1 4 1 7 7 1 3",
  "4 9 1 4 1 7 0 8 1 8 7 1",
  "4 0 3 7 4 3",
  "4 8 7",
  "9 10 8 10 11 8",
  "3 0 9 3 9 11 11 9 10",
  "0 1 10 0 10 8 8 10 11",
  "3 1 10 11 3 10",
  "1 2 11 1 11 9 9 11 8",
  "3 0 9 3 9 11 1 2 9 2 11 9",
  "0 2 11 8 0 11",
  "3 2 11",
  "2 3 8 2 8 10 10 8 9",
  "9 10 2 0 9 2",
  "2 3 8 2 8 10 0 1 8 1 10 8",
  "1 10 2",
  "1 3 8 9 1 8",
  "0 9 1",
  "0 3 8",
  "",
].join("\n")

const TRI_TABLE: Int8Array = (() => {
  let table = new Int8Array(256 * 16).fill(-1)
  let rows = TRI_TABLE_SOURCE.split("\n")
  if (rows.length !== 256) throw new Error(`the marching cubes table has ${rows.length} rows, not 256`)
  for (let pattern = 0; pattern < 256; pattern++) {
    let edges = rows[pattern]!.split(" ").filter(token => token.length > 0).map(Number)
    edges.forEach((edge, i) => (table[pattern * 16 + i] = edge))
  }
  return table
})()

export const marchingCubes = (grid: Grid, out: MeshBuilder): void => {
  let { origin, sampleSize, values } = grid
  let n = gridPoints(grid.samples)
  let cells = n - 1
  // A crossing is shared by the up-to-four cells around its edge; these
  // remember the vertex made for each edge, one array per axis.
  let edgeVertex = [new Int32Array(n * n * cells).fill(-1), new Int32Array(n * n * cells).fill(-1), new Int32Array(n * n * cells).fill(-1)]
  // A crossing that lands exactly on a corner (an exactly-zero sample) is
  // welded by the corner instead, so the edges through it agree.
  let cornerVertex = new Int32Array(n * n * n).fill(-1)
  let corners = new Float32Array(8)
  let vertices = new Int32Array(12)

  forEachActiveCell(grid, (cx, cy, cz) => {
    let pattern = 0
    for (let c = 0; c < 8; c++) {
      let o = CORNERS[c]!
      let value = values[((cz + o[2]) * n + cy + o[1]) * n + cx + o[0]]!
      corners[c] = value
      if (value < 0) pattern |= 1 << c
    }
    if (pattern === 0 || pattern === 255) return

    let mask = EDGE_MASK[pattern]!
    for (let edge = 0; edge < 12; edge++) {
      if ((mask & (1 << edge)) === 0) continue
      let [ca, cb] = EDGE_CORNERS[edge]!
      let a = CORNERS[ca]!
      let b = CORNERS[cb]!
      let va = corners[ca]!
      let vb = corners[cb]!
      let t = va / (va - vb)
      let slots: Int32Array
      let index: number
      if (t <= 0 || t >= 1) {
        let o = t <= 0 ? a : b
        slots = cornerVertex
        index = ((cz + o[2]) * n + cy + o[1]) * n + cx + o[0]
      } else {
        let axis = edgeAxis(edge)
        let ex = cx + Math.min(a[0], b[0])
        let ey = cy + Math.min(a[1], b[1])
        let ez = cz + Math.min(a[2], b[2])
        slots = edgeVertex[axis]!
        index = axis === 0 ? (ez * n + ey) * cells + ex : axis === 1 ? (ez * n + ex) * cells + ey : (ey * n + ex) * cells + ez
      }
      let known = slots[index]!
      if (known >= 0) {
        vertices[edge] = known
        continue
      }
      let made = out.vertex(
        origin[0] + (cx + a[0] + t * (b[0] - a[0]) - 1) * sampleSize,
        origin[1] + (cy + a[1] + t * (b[1] - a[1]) - 1) * sampleSize,
        origin[2] + (cz + a[2] + t * (b[2] - a[2]) - 1) * sampleSize,
      )
      slots[index] = made
      vertices[edge] = made
    }

    let row = pattern * 16
    for (let i = 0; TRI_TABLE[row + i]! !== -1; i += 3) {
      let p = vertices[TRI_TABLE[row + i]!]!
      let q = vertices[TRI_TABLE[row + i + 1]!]!
      let r = vertices[TRI_TABLE[row + i + 2]!]!
      // Two corners welded onto one point make a sliver of no area.
      if (p === q || q === r || p === r) continue
      // The table winds inward for this corner order; reversed, the faces point out.
      out.triangle(p, r, q)
    }
  })
}
