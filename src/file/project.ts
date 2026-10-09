// A project file (.sdfmod): a zip of manifest.json and model.bin, the same
// layout the web modeller writes (upstream ADR 0033). The operations go out
// as the bytes they already are; the manifest carries what the binary
// cannot say about a part: its id, whether it had a colour of its own, and
// the palette and mesher the document was using.

import type { MeshMode, Resolution } from "../mesh/mesh-model"
import { MESH_MODES, RESOLUTIONS } from "../mesh/mesh-model"
import type { Part } from "../model/part"
import type { RGBA } from "../model/types"
import { deserialiseOperations, serialiseOperations } from "./serialise"
import { writeZip, ZipReader } from "./zip"

export const PROJECT_EXTENSION = ".sdfmod"
export const PROJECT_VERSION = 1
export const MANIFEST_FILE = "manifest.json"
export const MODEL_FILE = "model.bin"
/** The most parts a model may hold (the store's limit, checked again on read). */
export const MAX_PARTS = 512
/** The most colours a palette keeps. */
export const PALETTE_LIMIT = 32
const MAX_PART_ID = 128

export interface ProjectView {
  readonly mode: MeshMode
  readonly resolution: Resolution
}

export interface Project {
  readonly parts: readonly Part[]
  readonly palette: readonly RGBA[]
  readonly view: ProjectView
}

export const writeProject = (project: Project): Uint8Array => {
  let { parts, palette, view } = project
  let manifest = {
    version: PROJECT_VERSION,
    ids: parts.map(part => part.id),
    coloured: parts.flatMap((part, index) => (part.colour == null ? [] : [index])),
    palette: palette.map(({ r, g, b, a }) => ({ r, g, b, a })),
    view: { mode: view.mode, resolution: view.resolution },
  }
  let model = serialiseOperations(
    parts.map(part => ({
      combine: part.combine,
      shape: part.shape,
      origin: part.origin,
      orientation: part.orientation,
      softness: part.softness,
      opacity: part.opacity ?? 1,
      ...(part.colour == null ? {} : { colour: part.colour }),
    })),
  )
  return writeZip([
    { name: MANIFEST_FILE, data: `${JSON.stringify(manifest, null, 2)}\n` },
    { name: MODEL_FILE, data: model },
  ])
}

const isChannel = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255

/** Reads a project, or throws a sentence naming what is wrong with it. */
export const readProject = (bytes: Uint8Array): Project => {
  let zip: ZipReader
  try {
    zip = new ZipReader(bytes)
  } catch {
    throw new Error("not a file a model was saved as")
  }
  let text = zip.textOf(MANIFEST_FILE)
  if (text === undefined) throw new Error(`no ${MANIFEST_FILE} at the file's root`)
  let manifest: Record<string, unknown>
  try {
    manifest = JSON.parse(text)
  } catch {
    throw new Error(`${MANIFEST_FILE} is not valid JSON`)
  }
  let ids = manifest.ids
  let coloured = manifest.coloured
  let palette = manifest.palette
  let view = manifest.view as Record<string, unknown> | null
  let valid =
    manifest.version === PROJECT_VERSION &&
    Array.isArray(ids) &&
    ids.length <= MAX_PARTS &&
    ids.every(id => typeof id === "string" && id.length > 0 && id.length <= MAX_PART_ID && id.trim() === id) &&
    new Set(ids).size === ids.length &&
    Array.isArray(coloured) &&
    coloured.every((index, i) => Number.isInteger(index) && index >= 0 && index < ids.length && (i === 0 || index > coloured[i - 1])) &&
    Array.isArray(palette) &&
    palette.length <= PALETTE_LIMIT &&
    palette.every(entry => typeof entry === "object" && entry !== null && isChannel(entry.r) && isChannel(entry.g) && isChannel(entry.b) && isChannel(entry.a)) &&
    typeof view === "object" &&
    view !== null &&
    typeof view.mode === "string" &&
    typeof view.resolution === "number" &&
    Number.isFinite(view.resolution) &&
    view.resolution > 0
  if (!valid) throw new Error(`${MANIFEST_FILE} is not a model manifest this build can open`)

  let model = zip.bytesOf(MODEL_FILE)
  if (model === undefined) throw new Error(`no ${MODEL_FILE} in the file`)
  let operations
  try {
    operations = deserialiseOperations(model)
  } catch (reason) {
    throw new Error(`${MODEL_FILE} is not a model this build reads: ${reason instanceof Error ? reason.message : String(reason)}`)
  }
  let names = ids as string[]
  if (operations.length !== names.length) throw new Error(`the manifest names ${names.length} parts and ${MODEL_FILE} holds ${operations.length}`)
  let colouredSet = new Set(coloured as number[])
  let parts = operations.map((operation, index): Part => {
    if (operation.combine === "Paint") throw new Error(`part ${index + 1} of the model is a Paint, which this application has no part for`)
    return {
      id: names[index]!,
      shape: operation.shape,
      origin: operation.origin,
      orientation: operation.orientation,
      combine: operation.combine,
      softness: operation.softness,
      ...(colouredSet.has(index) ? { colour: operation.colour ?? { r: 255, g: 255, b: 255 }, opacity: operation.opacity } : {}),
    }
  })
  // A mesher or resolution this build does not offer falls back to the
  // defaults rather than refusing a model that is otherwise fine.
  let mode = MESH_MODES.some(m => m.value === view!.mode) ? (view!.mode as MeshMode) : MESH_MODES[0]!.value
  let resolution = (RESOLUTIONS as readonly number[]).includes(view!.resolution as number) ? (view!.resolution as Resolution) : 0.25
  return {
    parts,
    palette: (palette as RGBA[]).map(({ r, g, b, a }) => ({ r, g, b, a })),
    view: { mode, resolution },
  }
}
