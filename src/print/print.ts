// A model out to a 3D printer as a 3MF (upstream ADR 0032): re-meshed with
// marching cubes at a print resolution, refused when it has open edges,
// stood on the bed at a height in millimetres, its colours reduced to what
// the printer has filaments for, written per triangle corner.

import type { MeshData } from "../mesh/builder"
import { budgetFor, meshParts, type MeshResult } from "../mesh/mesh-model"
import { describeReport } from "../mesh/report"
import type { Part } from "../model/part"
import type { RGBA } from "../model/types"
import { writeZip } from "../file/zip"

export const DEFAULT_HEIGHT_MM = 100
export const DEFAULT_MAX_COLOURS = 4
/** Finer than the preview default, coarser than the fine end. */
export const PRINT_VOXEL_SIZE = 0.125

export const printedMesh = (parts: readonly Part[]): MeshResult | undefined => meshParts(parts, budgetFor(PRINT_VOXEL_SIZE), "marching-cubes")

/** Why a mesh cannot be printed, as the sentence the export shows, or undefined. */
export const printProblem = (result: { triangles: number; boundaryEdges: number } | undefined): string | undefined => {
  if (result === undefined) return "this model has nothing in it to print"
  if (result.triangles === 0) return "this model has no surface in it — nothing to print"
  if (result.boundaryEdges > 0) return `${result.boundaryEdges} open edge${result.boundaryEdges === 1 ? "" : "s"} — the model is a lidless shell and will not print as drawn`
  return undefined
}

export { describeReport }

/**
 * The colours the corners use, most-used first and at most `maxColours`;
 * every other colour snaps to the nearest kept one. Returns a palette slot
 * per index of the triangle list.
 */
export const quantiseColours = (mesh: MeshData, maxColours: number): { palette: RGBA[]; slots: Uint8Array; distinct: number } => {
  if (!Number.isInteger(maxColours) || maxColours < 1) throw new Error("a printed model needs room for at least one colour")
  let rgbOf = (vertex: number): number => mesh.paints[vertex]! >>> 8
  let uses = new Map<number, number>()
  for (let i = 0; i < mesh.indices.length; i++) {
    let key = rgbOf(mesh.indices[i]!)
    uses.set(key, (uses.get(key) ?? 0) + 1)
  }
  let ranked = [...uses].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([key]) => key)
  let kept = ranked.slice(0, maxColours)
  let channels = (key: number) => [(key >>> 16) & 0xff, (key >>> 8) & 0xff, key & 0xff] as const
  let slotOf = new Map<number, number>()
  kept.forEach((key, slot) => slotOf.set(key, slot))
  for (let key of ranked) {
    if (slotOf.has(key)) continue
    let [r, g, b] = channels(key)
    let best = Infinity
    let nearest = 0
    kept.forEach((other, slot) => {
      let [or, og, ob] = channels(other)
      let distance = (r - or) ** 2 + (g - og) ** 2 + (b - ob) ** 2
      if (distance < best) {
        best = distance
        nearest = slot
      }
    })
    slotOf.set(key, nearest)
  }
  let slots = new Uint8Array(mesh.indices.length)
  for (let i = 0; i < mesh.indices.length; i++) slots[i] = slotOf.get(rgbOf(mesh.indices[i]!)) ?? 0
  return {
    palette: kept.map(key => {
      let [r, g, b] = channels(key)
      return { r, g, b, a: 255 }
    }),
    slots,
    distinct: ranked.length,
  }
}

/**
 * The positions in millimetres on a bed: scaled so the model is `heightMm`
 * tall, centred over the origin, its lowest point at z = 0, and turned from
 * the modeller's y-up to the printer's z-up.
 */
export const standOnBed = (mesh: MeshData, heightMm: number): Float32Array => {
  if (!Number.isFinite(heightMm) || heightMm <= 0) throw new Error("a printed model needs a height above the bed")
  let { positions, vertexCount } = mesh
  if (vertexCount === 0) throw new Error("this model has no height to print")
  let min = [Infinity, Infinity, Infinity]
  let max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < vertexCount * 3; i++) {
    let axis = i % 3
    min[axis] = Math.min(min[axis]!, positions[i]!)
    max[axis] = Math.max(max[axis]!, positions[i]!)
  }
  let tall = max[1]! - min[1]!
  if (!(tall > 0)) throw new Error("this model has no height to print")
  let scale = heightMm / tall
  let centreX = (min[0]! + max[0]!) / 2
  let centreZ = (min[2]! + max[2]!) / 2
  let stood = new Float32Array(vertexCount * 3)
  for (let v = 0; v < vertexCount * 3; v += 3) {
    stood[v] = (positions[v]! - centreX) * scale
    stood[v + 1] = -(positions[v + 2]! - centreZ) * scale
    stood[v + 2] = (positions[v + 1]! - min[1]!) * scale
  }
  return stood
}

const escapeXml = (text: string): string =>
  text.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!)

const hex = ({ r, g, b, a }: RGBA): string =>
  [r, g, b, a]
    .map(channel => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()

const millimetres = (value: number): string => `${Number.parseFloat(value.toFixed(3))}`

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="png" ContentType="image/png" />
  <Override PartName="/3D/3dmodel.model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>
`

const rootRels = (thumbnail: boolean): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '  <Relationship Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model" />',
    ...(thumbnail ? ['  <Relationship Id="rel-2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail" Target="/Metadata/thumbnail.png" />'] : []),
    "</Relationships>",
    "",
  ].join("\n")

/** One solid's model part: vertices in millimetres, a colour slot per triangle corner. */
const modelXml = (vertices: Float32Array, indices: Uint32Array, slots: Uint8Array, palette: readonly RGBA[], title: string): string => {
  let lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">',
    '  <metadata name="Application">sdf-modeller (SolidRT)</metadata>',
    `  <metadata name="Title">${escapeXml(title)}</metadata>`,
    "  <resources>",
    '    <m:colorgroup id="1">',
    ...(palette.length === 0 ? [{ r: 0, g: 0, b: 0, a: 255 }] : palette).map(colour => `      <m:color color="#${hex(colour)}" />`),
    "    </m:colorgroup>",
    '    <object id="2" type="model" pid="1" pindex="0">',
    "      <mesh>",
    "        <vertices>",
  ]
  for (let v = 0; v < vertices.length; v += 3) lines.push(`          <vertex x="${millimetres(vertices[v]!)}" y="${millimetres(vertices[v + 1]!)}" z="${millimetres(vertices[v + 2]!)}" />`)
  lines.push("        </vertices>", "        <triangles>")
  for (let t = 0; t < indices.length; t += 3) {
    lines.push(`          <triangle v1="${indices[t]}" v2="${indices[t + 1]}" v3="${indices[t + 2]}" p1="${slots[t]}" p2="${slots[t + 1]}" p3="${slots[t + 2]}" />`)
  }
  lines.push("        </triangles>", "      </mesh>", "    </object>", "  </resources>", "  <build>", '    <item objectid="2" />', "  </build>", "</model>", "")
  return lines.join("\n")
}

export interface PrintOptions {
  readonly heightMm: number
  readonly maxColours: number
  readonly title: string
  /** A PNG for the slicer's file list. */
  readonly thumbnail?: Uint8Array
}

/** The model as 3MF bytes, or a thrown sentence saying why it cannot be printed. */
export const exportThreeMf = (parts: readonly Part[], options: PrintOptions): Uint8Array => {
  let result = printedMesh(parts)
  let problem = printProblem(result && { triangles: result.mesh.triangleCount, boundaryEdges: result.report.boundaryEdges })
  if (problem !== undefined) throw new Error(problem)
  let mesh = result!.mesh
  let { palette, slots } = quantiseColours(mesh, options.maxColours)
  let vertices = standOnBed(mesh, options.heightMm)
  return writeZip([
    { name: "[Content_Types].xml", data: CONTENT_TYPES },
    { name: "_rels/.rels", data: rootRels(options.thumbnail !== undefined) },
    ...(options.thumbnail === undefined ? [] : [{ name: "Metadata/thumbnail.png", data: options.thumbnail }]),
    { name: "3D/3dmodel.model", data: modelXml(vertices, mesh.indices, slots, palette, options.title) },
  ])
}
