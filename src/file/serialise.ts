// The binary operation list a project's model.bin holds: big-mesh-studios'
// packages/csg serialise.ts, format version 5, byte for byte, so a model
// saved by the web modeller opens here and the other way round.
//
// Per operation, little-endian: combine (u8), primitive code (u8), origin
// (3 f32), orientation (4 f32), softness (f32), the shape's parameters
// (f32 each; a polygon's outline writes its point count first, then that
// many x, z pairs), colour (3 u8), opacity (f32), material (u8).
//
// Versions 4 and 3 are read too: neither can hold a polygon, and a version 3
// operation ends before the material byte. A model with no polygon is
// written at version 4, whose bytes for it are the same, so a saved project
// still opens in a build from before the polygon.

import { hasVariableWidth, parameterFloats, parametersToFloats, pointBounds, primitiveCode, primitiveFromCode, shapeFromFloats, type OperationShape } from "../model/primitives"
import type { Quat, Rgb8, Vec3 } from "../model/types"

export const FORMAT_VERSION = 5

/**
 * The older versions this build reads, each because its one difference is
 * known. Version 2 and below are not here: their bytes parse, but mean
 * something else (the capsule's length was along X, a colour counted only
 * on a Paint).
 */
export const READABLE_VERSIONS: ReadonlySet<number> = new Set([4, 3])

/** Bytes at the end of every operation a version did not write: version 4 appended the material. */
const ABSENT_TRAILING_BYTES: ReadonlyMap<number, number> = new Map([[3, 1]])

const FIXED_BYTES = 1 + 1 + 3 * 4 + 4 * 4 + 4 + 3 + 4 + 1
/** The colour, opacity and material after the parameters. */
const TRAILING_BYTES = 3 + 4 + 1

/** The lowest version that can describe these operations: the newest only for a shape that writes its own width. */
const versionToWrite = (operations: readonly Operation[]): number => {
  if (operations.some(operation => hasVariableWidth(operation.shape.type))) return FORMAT_VERSION
  for (let version of READABLE_VERSIONS) if (!ABSENT_TRAILING_BYTES.has(version)) return version
  return FORMAT_VERSION
}
const WHITE: Rgb8 = { r: 255, g: 255, b: 255 }

export type OperationCombine = "Add" | "Subtract" | "Paint"
const COMBINES: readonly OperationCombine[] = ["Add", "Subtract", "Paint"]

export interface Operation {
  readonly combine: OperationCombine
  readonly shape: OperationShape
  readonly origin: Vec3
  readonly orientation: Quat
  readonly softness: number
  /** Written as white when absent; the manifest says which parts had one. */
  readonly colour?: Rgb8
  readonly opacity: number
  readonly material?: number
}

export const serialiseOperations = (operations: readonly Operation[]): Uint8Array => {
  let size = 6
  // Sized from the flattened shape, not its type: a polygon's width is its own.
  for (let operation of operations) size += FIXED_BYTES + parametersToFloats(operation.shape).length * 4
  let bytes = new Uint8Array(size)
  let view = new DataView(bytes.buffer)
  view.setUint16(0, versionToWrite(operations), true)
  view.setUint32(2, operations.length, true)
  let at = 6
  for (let operation of operations) {
    view.setUint8(at, COMBINES.indexOf(operation.combine))
    view.setUint8(at + 1, primitiveCode(operation.shape.type))
    view.setFloat32(at + 2, operation.origin.x, true)
    view.setFloat32(at + 6, operation.origin.y, true)
    view.setFloat32(at + 10, operation.origin.z, true)
    view.setFloat32(at + 14, operation.orientation.x, true)
    view.setFloat32(at + 18, operation.orientation.y, true)
    view.setFloat32(at + 22, operation.orientation.z, true)
    view.setFloat32(at + 26, operation.orientation.w, true)
    view.setFloat32(at + 30, operation.softness, true)
    at += 34
    for (let value of parametersToFloats(operation.shape)) {
      view.setFloat32(at, value, true)
      at += 4
    }
    let colour = operation.colour ?? WHITE
    view.setUint8(at, colour.r)
    view.setUint8(at + 1, colour.g)
    view.setUint8(at + 2, colour.b)
    view.setFloat32(at + 3, operation.opacity, true)
    view.setUint8(at + 7, operation.material ?? 0)
    at += 8
  }
  return bytes
}

export const deserialiseOperations = (bytes: Uint8Array): Operation[] => {
  if (bytes.length < 6) throw new Error(`a model needs at least 6 bytes for its version and count, and this one is ${bytes.length}`)
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let version = view.getUint16(0, true)
  if (version !== FORMAT_VERSION && !READABLE_VERSIONS.has(version)) throw new Error(`this model is version ${version} and this build reads version ${FORMAT_VERSION}`)
  let absent = version === FORMAT_VERSION ? 0 : (ABSENT_TRAILING_BYTES.get(version) ?? 0)
  let fixedBytes = FIXED_BYTES - absent
  let trailingBytes = TRAILING_BYTES - absent
  let count = view.getUint32(2, true)
  let operations: Operation[] = []
  let at = 6
  for (let i = 0; i < count; i++) {
    if (at + fixedBytes > bytes.length) throw new Error(`operation ${i} of ${count} runs past the end of the model`)
    let combine = COMBINES[view.getUint8(at)]
    if (combine === undefined) throw new Error(`operation ${i} has combine mode ${view.getUint8(at)}, which is not one`)
    let type = primitiveFromCode(view.getUint8(at + 1))
    if (type === null) throw new Error(`operation ${i} is shape ${view.getUint8(at + 1)}, which this build does not know`)
    let origin = { x: view.getFloat32(at + 2, true), y: view.getFloat32(at + 6, true), z: view.getFloat32(at + 10, true) }
    let orientation = { x: view.getFloat32(at + 14, true), y: view.getFloat32(at + 18, true), z: view.getFloat32(at + 22, true), w: view.getFloat32(at + 26, true) }
    let softness = view.getFloat32(at + 30, true)
    at += 34
    let floats: number[] = []
    let params = parameterFloats(type)
    let bounds = pointBounds(type)
    if (bounds !== undefined) {
      // A shape that writes its own width cannot be in a file that predates it.
      if (version !== FORMAT_VERSION) throw new Error(`this model is version ${version} and ${type} carries its own width, which version ${version} could not write`)
      // The point count comes first, read before the points and clamped to
      // the table, so a hostile count cannot walk the read off the end.
      if (at + 4 > bytes.length) throw new Error(`operation ${i} of ${count} runs past the end of the model`)
      let written = view.getFloat32(at, true)
      params += 2 * Math.floor(Math.min(Math.max(Number.isFinite(written) ? written : 0, bounds[0]), bounds[1]))
    }
    if (at + params * 4 + trailingBytes > bytes.length) throw new Error(`operation ${i} of ${count} runs past the end of the model`)
    for (let p = 0; p < params; p++, at += 4) floats.push(view.getFloat32(at, true))
    let colour = { r: view.getUint8(at), g: view.getUint8(at + 1), b: view.getUint8(at + 2) }
    let opacity = view.getFloat32(at + 3, true)
    at += 7
    // A version 3 operation ends here; reading a material byte would take the next operation's first.
    let material = 0
    if (absent === 0) {
      material = view.getUint8(at)
      at += 1
    }
    operations.push({ combine, shape: shapeFromFloats(type, floats), origin, orientation, softness, colour, opacity, ...(material === 0 ? {} : { material }) })
  }
  return operations
}
