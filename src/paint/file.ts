// The paint journal as bytes, the `paint.bin` entry of a project file: the
// only durable form paint has (the field is derived and never saved).
// Ported from big-mesh-studios' sdf-modeller unwrapping/paint-file.ts.
//
// Little-endian: a 32-byte header (u16 version, then u32 dabs and u32
// strokes at 4 and 8), the six journal arrays back to back as aligned
// typed views (centre f32x3, normal f32x3, radius f32, hardness f32, colour
// u8x4, part u32), then the stroke ends as u32. Every count is bounded
// before it sizes anything, and the length is checked last.

import type { PaintJournal } from "./journal"

/** The most dabs a file may hold: about eighty megabytes of journal. */
export const MAX_PAINT_DABS = 1 << 21

const HEADER_BYTES = 32
const PAINT_VERSION = 1
/** What a dab costs on disk, stated here and held to the journal's DAB_BYTES by a test. */
export const PAINT_DAB_BYTES = 40

const offsets = (dabs: number) => ({
  centre: HEADER_BYTES,
  normal: HEADER_BYTES + dabs * 12,
  radius: HEADER_BYTES + dabs * 24,
  hardness: HEADER_BYTES + dabs * 28,
  colour: HEADER_BYTES + dabs * 32,
  part: HEADER_BYTES + dabs * 36,
})

const fileBytes = (dabs: number, strokes: number): number => offsets(dabs).part + dabs * 4 + strokes * 4

/** A journal file once read, before a journal adopts it. */
export interface PaintFile {
  readonly dabs: number
  /** Where every finished stroke ends, as dab counts. */
  readonly strokes: readonly number[]
  readonly centre: Float32Array
  readonly normal: Float32Array
  readonly radius: Float32Array
  readonly hardness: Float32Array
  readonly colour: Uint8Array
  readonly part: Uint32Array
}

/** A journal as one zip entry's bytes; undefined for no journal or an empty one (no entry is written). */
export const writePaint = (journal: PaintJournal | undefined): Uint8Array | undefined => {
  if (journal === undefined) return undefined
  let dabs = journal.count
  if (dabs === 0) return undefined
  let strokes = journal.strokeEnds
  let at = offsets(dabs)
  let buffer = new ArrayBuffer(fileBytes(dabs, strokes.length))
  let fields = new DataView(buffer)
  fields.setUint16(0, PAINT_VERSION, true)
  fields.setUint32(4, dabs, true)
  fields.setUint32(8, strokes.length, true)
  new Float32Array(buffer, at.centre, dabs * 3).set(journal.centre.subarray(0, dabs * 3))
  new Float32Array(buffer, at.normal, dabs * 3).set(journal.normal.subarray(0, dabs * 3))
  new Float32Array(buffer, at.radius, dabs).set(journal.radius.subarray(0, dabs))
  new Float32Array(buffer, at.hardness, dabs).set(journal.hardness.subarray(0, dabs))
  new Uint8Array(buffer, at.colour, dabs * 4).set(journal.colour.subarray(0, dabs * 4))
  new Uint32Array(buffer, at.part, dabs).set(journal.part.subarray(0, dabs))
  new Uint32Array(buffer, at.part + dabs * 4, strokes.length).set(strokes)
  return new Uint8Array(buffer)
}

/** Reads what `writePaint` wrote, or throws a sentence naming what is wrong. */
export const readPaint = (bytes: Uint8Array): PaintFile => {
  // Copied to a buffer of its own: a zip entry may start at any offset, and
  // the views below need four-byte alignment.
  let buffer = bytes.slice().buffer
  if (buffer.byteLength < HEADER_BYTES) throw new Error(`paint.bin is ${buffer.byteLength} bytes and a header is ${HEADER_BYTES}`)
  let fields = new DataView(buffer)
  let version = fields.getUint16(0, true)
  if (version !== PAINT_VERSION) throw new Error(`paint.bin is version ${version} and this build reads version ${PAINT_VERSION}`)
  let dabs = fields.getUint32(4, true)
  let strokeCount = fields.getUint32(8, true)
  if (dabs === 0 || dabs > MAX_PAINT_DABS) throw new Error(`paint.bin names ${dabs} dabs and the limit is ${MAX_PAINT_DABS}`)
  if (strokeCount === 0 || strokeCount > dabs) throw new Error(`paint.bin names ${strokeCount} strokes over ${dabs} dabs, which is not a shape a stroke list can have`)
  let expected = fileBytes(dabs, strokeCount)
  if (expected !== buffer.byteLength) throw new Error(`paint.bin holds ${buffer.byteLength} bytes and ${dabs} dabs over ${strokeCount} strokes need ${expected}`)

  let at = offsets(dabs)
  let strokes = Array.from(new Uint32Array(buffer, at.part + dabs * 4, strokeCount))
  let previous = 0
  for (let end of strokes) {
    if (end <= previous || end > dabs) throw new Error(`paint.bin puts a stroke end at ${end}, after ${previous} and within ${dabs} dabs`)
    previous = end
  }

  let centre = new Float32Array(buffer, at.centre, dabs * 3).slice()
  let normal = new Float32Array(buffer, at.normal, dabs * 3).slice()
  let radius = new Float32Array(buffer, at.radius, dabs).slice()
  let hardness = new Float32Array(buffer, at.hardness, dabs).slice()
  for (let dab = 0; dab < dabs; dab++) {
    if (!Number.isFinite(radius[dab]!) || radius[dab]! <= 0) throw new Error(`paint.bin gives dab ${dab} a radius of ${radius[dab]}`)
    if (!Number.isFinite(hardness[dab]!) || hardness[dab]! < 0 || hardness[dab]! > 1) throw new Error(`paint.bin gives dab ${dab} a hardness of ${hardness[dab]}`)
    for (let axis of [0, 1, 2]) {
      if (!Number.isFinite(centre[dab * 3 + axis]!)) throw new Error(`paint.bin gives dab ${dab} a centre that is not finite`)
    }
    // A zero normal would make every voxel of the dab's box look on the surface: a slab.
    let length = Math.hypot(normal[dab * 3]!, normal[dab * 3 + 1]!, normal[dab * 3 + 2]!)
    if (!Number.isFinite(length) || length < 0.5) throw new Error(`paint.bin gives dab ${dab} a normal ${length} long`)
  }

  return {
    dabs,
    strokes,
    centre,
    normal,
    radius,
    hardness,
    colour: new Uint8Array(buffer, at.colour, dabs * 4).slice(),
    part: new Uint32Array(buffer, at.part, dabs).slice(),
  }
}
