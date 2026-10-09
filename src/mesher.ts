"use isolate"
// The mesher, off the UI thread. Sampling a model is hundreds of thousands
// of field evaluations in an interpreter (tens of milliseconds at the
// default resolution, about a second at the finest), so it runs here and
// the UI keeps answering a finger meanwhile. Results come back packed in
// @solidrt/3d's "colored" vertex layout, ready to draw.

import type { MeshData } from "./mesh/builder"
import { budgetFor, meshParts, partMesh, type MeshMode } from "./mesh/mesh-model"
import type { MeshReport } from "./mesh/report"
import type { Part } from "./model/part"
import { exportThreeMf as writeThreeMf, type PrintOptions } from "./print/print"

/** What the viewport draws, plus what the status line says about it. */
export interface ViewMesh {
  /** Interleaved per vertex: position (3), normal (3), uv (2, unused), premultiplied linear colour (4). */
  readonly vertices: Float32Array
  readonly indices: Uint32Array
  readonly triangles: number
  readonly samples: number
  readonly report: MeshReport
  /** Whether any vertex is translucent, which decides the material. */
  readonly translucent: boolean
  readonly ms: number
}

const FLOATS = 12

// The 256 sRGB byte values in linear light, so packing is a lookup.
const LINEAR = Float32Array.from({ length: 256 }, (_, i) => {
  let c = i / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
})

const pack = (mesh: MeshData): { vertices: Float32Array; translucent: boolean } => {
  let vertices = new Float32Array(mesh.vertexCount * FLOATS)
  let translucent = false
  for (let v = 0; v < mesh.vertexCount; v++) {
    let at = v * FLOATS
    vertices[at] = mesh.positions[v * 3]!
    vertices[at + 1] = mesh.positions[v * 3 + 1]!
    vertices[at + 2] = mesh.positions[v * 3 + 2]!
    vertices[at + 3] = mesh.normals[v * 3]!
    vertices[at + 4] = mesh.normals[v * 3 + 1]!
    vertices[at + 5] = mesh.normals[v * 3 + 2]!
    let paint = mesh.paints[v]!
    let alpha = (paint & 0xff) / 255
    if (alpha < 1) translucent = true
    vertices[at + 8] = LINEAR[paint >>> 24]! * alpha
    vertices[at + 9] = LINEAR[(paint >>> 16) & 0xff]! * alpha
    vertices[at + 10] = LINEAR[(paint >>> 8) & 0xff]! * alpha
    vertices[at + 11] = alpha
  }
  return { vertices, translucent }
}

/** The model meshed at `voxelSize`, or null when it has no parts. */
export function mesh(parts: Part[], voxelSize: number, mode: MeshMode): ViewMesh | null {
  let started = performance.now()
  let result = meshParts(parts, budgetFor(voxelSize), mode)
  if (result === undefined) return null
  let { vertices, translucent } = pack(result.mesh)
  return {
    vertices,
    indices: result.mesh.indices,
    triangles: result.mesh.triangleCount,
    samples: result.samples,
    report: result.report,
    translucent,
    ms: performance.now() - started,
  }
}

/** One part's own shape at its own origin, for the drag ghost. */
export function ghost(part: Part): { vertices: Float32Array; indices: Uint32Array } | null {
  let result = partMesh(part, budgetFor(0.25))
  if (result === undefined || result.mesh.triangleCount === 0) return null
  return { vertices: pack(result.mesh).vertices, indices: result.mesh.indices }
}

/** The model as a 3MF print; rejects with the sentence that says why it cannot be. */
export function exportThreeMf(parts: Part[], options: PrintOptions): Uint8Array {
  return writeThreeMf(parts, options)
}
