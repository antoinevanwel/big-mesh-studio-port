// A document's parts into triangles: the region and resolution a model is
// sampled at, the mesher, the normals and colours, the colour seams, the
// report. Ported from big-mesh-studios' packages/meshing model-mesh.ts.

import { Field, fieldBounds } from "../model/field"
import type { Part } from "../model/part"
import { MeshBuilder, type MeshData } from "./builder"
import { splitColourSeams } from "./colour-seams"
import { sampleGrid } from "./grid"
import { marchingCubes } from "./marching-cubes"
import { fillNormals } from "./normals"
import { reportMesh, type MeshReport } from "./report"
import { surfaceNets } from "./surface-nets"

export type MeshMode = "marching-cubes" | "surface-nets"

export const DEFAULT_MESH_MODE: MeshMode = "marching-cubes"

export const MESH_MODES: readonly { value: MeshMode; label: string; hint: string }[] = [
  {
    value: "marching-cubes",
    label: "Cubes",
    hint: "Vertices on the true surface. Closed at every resolution, and the only one whose colour boundaries can be cut. The one to print.",
  },
  {
    value: "surface-nets",
    label: "Nets",
    hint: "One vertex per cell, the fewest triangles. Closed wherever the surface is well resolved, but its edges float off the surface.",
  },
]

/**
 * The voxel sizes the resolution control offers. A list rather than a
 * range: each step halves the size, doubles the samples per axis and
 * multiplies the work by eight, so in-between values buy nothing a person
 * can predict.
 */
export const RESOLUTIONS = [0.5, 0.25, 0.125, 0.0625] as const

export type Resolution = (typeof RESOLUTIONS)[number]

export const DEFAULT_RESOLUTION: Resolution = 0.25

export interface MeshBudget {
  readonly voxelSize: number
  readonly maxSamplesPerAxis: number
  readonly minSamplesPerAxis: number
}

export const budgetFor = (voxelSize: number): MeshBudget => ({ voxelSize, maxSamplesPerAxis: 96, minSamplesPerAxis: 8 })

/** How many samples a model's thinnest axis gets at least, so a flat part still meshes. */
const MIN_SAMPLES_ACROSS_THIN = 3

/**
 * Samples along the longest axis: the voxel size asks for a number, the
 * budget clamps it at both ends (a huge model is meshed coarser rather than
 * not at all), and a thin model asks for enough to resolve its thin side.
 */
export const samplesFor = (bounds: readonly number[], budget: MeshBudget): number => {
  let spans = [bounds[3]! - bounds[0]!, bounds[4]! - bounds[1]!, bounds[5]! - bounds[2]!]
  let longest = Math.max(...spans)
  let shortest = Math.min(...spans)
  let forLongest = Math.max(budget.minSamplesPerAxis, Math.min(budget.maxSamplesPerAxis, Math.ceil(longest / budget.voxelSize)))
  let forThinnest = Math.ceil((forLongest * MIN_SAMPLES_ACROSS_THIN) / shortest)
  return Math.min(budget.maxSamplesPerAxis, Math.max(forLongest, forThinnest))
}

export interface MeshRegion {
  readonly origin: readonly [number, number, number]
  readonly samples: number
  readonly sampleSize: number
}

/** The cube a model is sampled over, cells kept cubic by the longest axis. */
export const meshRegion = (parts: readonly Part[], budget: MeshBudget): MeshRegion | undefined => {
  let bounds = fieldBounds(parts, budget.voxelSize)
  if (bounds === undefined) return undefined
  let samples = samplesFor(bounds, budget)
  let longest = Math.max(bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2])
  let sampleSize = longest / samples
  return { origin: [bounds[0] - sampleSize / 2, bounds[1] - sampleSize / 2, bounds[2] - sampleSize / 2], samples, sampleSize }
}

export interface MeshResult {
  readonly mesh: MeshData
  readonly region: MeshRegion
  /** How many field samples the grid took. */
  readonly samples: number
  readonly report: MeshReport
}

export const meshParts = (parts: readonly Part[], budget: MeshBudget, mode: MeshMode = DEFAULT_MESH_MODE): MeshResult | undefined => {
  let region = meshRegion(parts, budget)
  if (region === undefined) return undefined
  let field = new Field(parts)
  let grid = sampleGrid(field, region.origin, region.samples, region.sampleSize)
  let builder = new MeshBuilder()
  if (mode === "marching-cubes") marchingCubes(grid, builder)
  else surfaceNets(grid, builder)
  let built = builder.finish()
  fillNormals(built, field, region.sampleSize)
  for (let v = 0; v < built.vertexCount; v++) {
    built.paints[v] = field.paintAt(built.positions[v * 3]!, built.positions[v * 3 + 1]!, built.positions[v * 3 + 2]!)
  }
  let mesh = mode === "marching-cubes" ? splitColourSeams(built, (x, y, z) => field.paintAt(x, y, z)) : built
  return { mesh, region, samples: (region.samples + 2) ** 3, report: reportMesh(mesh) }
}

/**
 * One part on its own, at its own origin, for a drag ghost: forced to a
 * hard-edged union, because a lone cut folded against nothing is nothing,
 * and the ghost shows the shape that is moving rather than its effect.
 */
export const partMesh = (part: Part, budget: MeshBudget): MeshResult | undefined =>
  meshParts([{ ...part, origin: { x: 0, y: 0, z: 0 }, combine: "Add", softness: 0 }], budget, "surface-nets")
