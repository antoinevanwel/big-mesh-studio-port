// What came back from a mesher: whether the mesh is closed, manifold and
// consistently wound, and its volume. Edges are matched by rounded world
// position rather than by index, so a mesh that holds two vertices at one
// point (a cut colour seam does, on purpose) still reads as closed
// (upstream ADR 0030).

import type { MeshData } from "./builder"

/** The welding resolution, as a fraction of the mesh's bounding diagonal. */
export const WELD_PRECISION = 1e-6

export interface MeshReport {
  readonly vertexCount: number
  readonly triangleCount: number
  readonly boundaryEdges: number
  readonly nonManifoldEdges: number
  readonly inconsistentEdges: number
  readonly degenerateTriangles: number
  readonly volume: number
  readonly watertight: boolean
}

export const reportMesh = (mesh: MeshData): MeshReport => {
  let { positions, indices, vertexCount, triangleCount } = mesh
  let lo = [Infinity, Infinity, Infinity]
  let hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < vertexCount * 3; i++) {
    let axis = i % 3
    let value = positions[i]!
    if (value < lo[axis]!) lo[axis] = value
    if (value > hi[axis]!) hi[axis] = value
  }
  let extent = vertexCount === 0 ? 0 : Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!)
  let quantum = Math.max(extent * WELD_PRECISION, Number.EPSILON)

  // Every vertex to the id of the point it rounds to.
  let pointIds = new Map<string, number>()
  let weld = new Int32Array(vertexCount)
  for (let v = 0; v < vertexCount; v++) {
    let key = `${Math.round(positions[v * 3]! / quantum)},${Math.round(positions[v * 3 + 1]! / quantum)},${Math.round(positions[v * 3 + 2]! / quantum)}`
    let id = pointIds.get(key)
    if (id === undefined) {
      id = pointIds.size
      pointIds.set(key, id)
    }
    weld[v] = id
  }

  // Per undirected edge: how many triangles use it, and whether two of
  // them walk it the same way (a winding flip).
  let points = pointIds.size
  let uses = new Map<number, number>()
  let forwardOnce = new Map<number, boolean>()
  let inconsistent = new Set<number>()
  for (let t = 0; t < triangleCount; t++) {
    for (let e = 0; e < 3; e++) {
      let a = weld[indices[t * 3 + e]!]!
      let b = weld[indices[t * 3 + ((e + 1) % 3)]!]!
      if (a === b) continue
      let forward = a < b
      let key = forward ? a * points + b : b * points + a
      let seen = uses.get(key) ?? 0
      uses.set(key, seen + 1)
      if (seen === 0) forwardOnce.set(key, forward)
      else if (forwardOnce.get(key) === forward) inconsistent.add(key)
    }
  }
  let boundaryEdges = 0
  let nonManifoldEdges = 0
  let inconsistentEdges = 0
  for (let [key, count] of uses) {
    if (count === 1) boundaryEdges++
    else if (count > 2) nonManifoldEdges++
    else if (inconsistent.has(key)) inconsistentEdges++
  }

  let degenerateTriangles = 0
  let volume = 0
  for (let t = 0; t < triangleCount; t++) {
    let a = indices[t * 3]! * 3
    let b = indices[t * 3 + 1]! * 3
    let c = indices[t * 3 + 2]! * 3
    let ax = positions[a]!, ay = positions[a + 1]!, az = positions[a + 2]!
    let bx = positions[b]!, by = positions[b + 1]!, bz = positions[b + 2]!
    let cx = positions[c]!, cy = positions[c + 1]!, cz = positions[c + 2]!
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay)
    let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
    let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    if (a === b || b === c || a === c || (nx === 0 && ny === 0 && nz === 0)) {
      degenerateTriangles++
      continue
    }
    volume += (ax * (by * cz - cy * bz) + bx * (cy * az - ay * cz) + cx * (ay * bz - by * az)) / 6
  }

  return {
    vertexCount,
    triangleCount,
    boundaryEdges,
    nonManifoldEdges,
    inconsistentEdges,
    degenerateTriangles,
    volume,
    watertight: triangleCount > 0 && boundaryEdges === 0 && nonManifoldEdges === 0 && inconsistentEdges === 0 && degenerateTriangles === 0 && volume > 0,
  }
}

/** The report as the end of the status line. */
export const describeReport = (report: MeshReport): string => {
  if (report.triangleCount === 0) return "no surface"
  if (report.watertight) return `watertight · ${Math.round(report.volume * 100) / 100}u³`
  if (report.boundaryEdges > 0) return `${report.boundaryEdges} open edge${report.boundaryEdges === 1 ? "" : "s"} — not printable`
  let problems: string[] = []
  if (report.nonManifoldEdges > 0) problems.push(`${report.nonManifoldEdges} non-manifold edges`)
  if (report.inconsistentEdges > 0) problems.push(`${report.inconsistentEdges} edges wound the same way`)
  if (report.degenerateTriangles > 0) problems.push(`${report.degenerateTriangles} degenerate triangles`)
  return problems.join(", ")
}
