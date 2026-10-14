import { test, expect } from "flux:test"
import { readProject, writeProject } from "../src/file/project"
import { writeZip, ZipReader } from "../src/file/zip"
import { Field } from "../src/model/field"
import { conjugate, newModel, placedPart, pointInPartFrame, rotate, type Part } from "../src/model/part"
import type { Vec3 } from "../src/model/types"
import { PaintBrush, type Localiser } from "../src/paint/brush"
import { BRICK, GRID_RES, PaintField, SLOT } from "../src/paint/field"
import { PAINT_DAB_BYTES, readPaint, writePaint } from "../src/paint/file"
import { DAB_BYTES, PaintJournal } from "../src/paint/journal"
import { rasterise, type Placed } from "../src/paint/rasterise"
import { fieldHitAlong, type BrushSurface } from "../src/view/field-hit"

const RED = { r: 255, g: 0, b: 0, a: 255 }

/** A field over a fifty-unit box at 0.1 a voxel, four slots a side so a test stays small. */
const smallField = (): PaintField => PaintField.over(0.1, [0, 0, 0], [50, 50, 50], 4)

/** Every dab exactly where the journal says. */
const asWritten = (_part: number, centre: Vec3, normal: Vec3): Placed => ({ centre, normal })

type DabSpec = { at: [number, number, number]; normal?: [number, number, number]; radius: number; hardness?: number; colour?: typeof RED; newStroke?: boolean }

const journalWith = (dabs: readonly DabSpec[]): PaintJournal => {
  let journal = new PaintJournal()
  for (let dab of dabs) {
    if (dab.newStroke) journal.endStroke()
    journal.append({ centre: dab.at, normal: dab.normal ?? [0, 1, 0], radius: dab.radius, hardness: dab.hardness ?? 1, colour: dab.colour ?? RED, part: 0 })
  }
  journal.endStroke()
  return journal
}

const dab = (x: number, part = 0) => ({ centre: [x, 0, 0] as [number, number, number], normal: [0, 1, 0] as [number, number, number], radius: 0.5, hardness: 1, colour: RED, part })

// -- The journal ---------------------------------------------------------------

test("a journal undoes one stroke at a time, newest first, and redoes it", () => {
  let journal = new PaintJournal()
  journal.append(dab(1))
  journal.append(dab(2))
  journal.endStroke()
  journal.append(dab(3))
  journal.endStroke()
  expect(journal.strokeCount).toBe(2)
  let taken = journal.undoStroke()!
  expect(taken.count).toBe(1)
  expect(taken.centre[0]).toBe(3)
  expect(journal.count).toBe(2)
  journal.redoStroke(taken)
  expect(journal.count).toBe(3)
  expect(journal.strokeEnds).toEqual([2, 3])
})

test("a journal undoes the stroke before the one in progress, not the one in progress", () => {
  let journal = new PaintJournal()
  journal.append(dab(1))
  journal.endStroke()
  journal.append(dab(2))
  journal.append(dab(3))
  let taken = journal.undoStroke()!
  expect(taken.count).toBe(1)
  expect(journal.count).toBe(0)
})

test("a journal records no empty stroke, and grows past its first capacity", () => {
  let journal = new PaintJournal()
  journal.endStroke()
  expect(journal.strokeCount).toBe(0)
  for (let i = 0; i < 200; i++) journal.append(dab(i))
  journal.endStroke()
  expect(journal.count).toBe(200)
  expect(journal.centre[199 * 3]).toBe(199)
})

test("a cleared journal comes back stroke by stroke", () => {
  let journal = new PaintJournal()
  for (let i = 0; i < 3; i++) {
    journal.append(dab(i))
    journal.endStroke()
  }
  let removed = journal.clearWithUndo()!
  expect(removed.strokes).toEqual([1, 2, 3])
  expect(journal.count).toBe(0)
  journal.redoStroke(removed)
  expect(journal.strokeCount).toBe(3)
  journal.undoStroke()
  expect(journal.count).toBe(2)
})

// -- The field -----------------------------------------------------------------

test("a field allocates nothing until written, then one brick, and reads back", () => {
  let f = smallField()
  expect(f.brickCount).toBe(0)
  expect(f.set(3, 4, 5, { r: 10, g: 20, b: 30, a: 255 })).toBe(true)
  expect(f.brickCount).toBe(1)
  expect(f.get(3, 4, 5)).toEqual({ r: 10, g: 20, b: 30, a: 255 })
  expect(f.get(2, 4, 5)).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  expect(f.set(3, 4, 5, { r: 10, g: 20, b: 30, a: 255 })).toBe(false)
})

test("a field copies an edge voxel into its own brick's gutter", () => {
  let f = smallField()
  f.set(BRICK - 1, 0, 0, RED)
  // The slot's last cell along x holds the brick's last voxel again.
  let edge = f.poolDim
  let at = (x: number) => x * 4
  expect(f.pool[at(BRICK)]).toBe(255)
  expect(f.pool[at(SLOT - 1)]).toBe(255)
  expect(edge).toBe(4 * SLOT)
})

test("a field drops writes once its pool is full rather than throwing", () => {
  let f = PaintField.over(0.1, [0, 0, 0], [50, 50, 50], 1)
  expect(f.set(0, 0, 0, RED)).toBe(true)
  expect(f.set(BRICK * 2, 0, 0, RED)).toBe(false)
})

test("a field refuses a box its indirection grid cannot cover", () => {
  expect(() => PaintField.over(0.1, [0, 0, 0], [GRID_RES * BRICK * 0.1 + 1, 1, 1], 4)).toThrow()
})

test("a field cleared whole gives every brick back", () => {
  let f = smallField()
  f.set(0, 0, 0, RED)
  f.set(40, 40, 40, RED)
  f.clearAll()
  expect(f.brickCount).toBe(0)
  expect(f.get(0, 0, 0).a).toBe(0)
})

// -- Rasterising ---------------------------------------------------------------

test("a dab paints where the journal says, a disc on the surface and a shell across it", () => {
  let f = smallField()
  rasterise(journalWith([{ at: [10, 10, 10], radius: 0.5 }]), f, asWritten)
  expect(f.get(100, 100, 100)).toEqual(RED)
  expect(f.get(104, 100, 100).a).toBe(255)
  expect(f.get(100, 103, 100).a).toBe(0)
})

test("a repaint within a stroke is one write, and a stroke over another colour is live", () => {
  expect(rasterise(journalWith([{ at: [10, 10, 10], radius: 0.5 }, { at: [10, 10, 10], radius: 0.5 }]), smallField(), asWritten).live).toBe(1)
  let overGreen = journalWith([
    { at: [10, 10, 10], radius: 0.5, colour: { r: 0, g: 255, b: 0, a: 255 } },
    { at: [10, 10, 10], radius: 0.5, newStroke: true },
  ])
  expect(rasterise(overGreen, smallField(), asWritten).live).toBe(2)
})

test("a soft brush stays soft however many dabs the stroke has", () => {
  let f = smallField()
  let journal = new PaintJournal()
  for (let i = 0; i <= 12; i++) journal.append({ centre: [10 + (i * 0.5) / 3, 10, 10], normal: [0, 1, 0], radius: 0.5, hardness: 0, colour: { r: 255, g: 255, b: 255, a: 255 }, part: 0 })
  journal.endStroke()
  rasterise(journal, f, asWritten)
  let alphas = [0, 1, 2, 3, 4].map(out => f.get(100, 100, 100 + out).a)
  for (let i = 1; i < alphas.length; i++) expect(alphas[i]!).toBeLessThan(alphas[i - 1]!)
  expect(alphas[0]!).toBeGreaterThan(200)
})

test("a translucent brush held still builds up", () => {
  let f = smallField()
  let one = smallField()
  let translucent = { r: 255, g: 255, b: 255, a: 64 }
  rasterise(journalWith(Array.from({ length: 6 }, () => ({ at: [10, 10, 10] as [number, number, number], radius: 0.5, colour: translucent }))), f, asWritten)
  rasterise(journalWith([{ at: [10, 10, 10], radius: 0.5, colour: translucent }]), one, asWritten)
  expect(f.get(100, 100, 100).a).toBeGreaterThan(one.get(100, 100, 100).a)
  expect(f.get(100, 100, 100).a).toBeGreaterThan(64)
})

test("a hard edge is antialiased rather than stepped, and a tiny brush is not widened", () => {
  let f = smallField()
  rasterise(journalWith([{ at: [10, 10, 10], radius: 0.5 }]), f, asWritten)
  let rim: number[] = []
  for (let z = 100; z < 112; z++) rim.push(f.get(100, 100, z).a)
  let last = rim.reduce((at, a, i) => (a > 0 ? i : at), -1)
  expect(rim[last]!).toBeLessThan(255)
  expect(rim[last + 1]).toBe(0)
  let small = smallField()
  rasterise(journalWith([{ at: [10, 10, 10], radius: 0.1 }]), small, asWritten)
  expect(small.get(99, 100, 100).a).toBeGreaterThan(0)
  expect(small.get(102, 100, 100).a).toBe(0)
})

test("a placer that refuses a dab skips it", () => {
  let f = smallField()
  rasterise(journalWith([{ at: [10, 10, 10], radius: 0.5 }]), f, () => undefined)
  expect(f.brickCount).toBe(0)
})

// -- The brush -----------------------------------------------------------------

const localiseAsIs: Localiser = (_part, point, normal) => ({ centre: [point.x, point.y, point.z], normal: [normal.x, normal.y, normal.z] })
const hitAt = (x: number, part = 0) => ({ point: { x, y: 10, z: 10 }, normal: { x: 0, y: 1, z: 0 }, part })

test("a brush puts one dab down for a tap and fills in a gap", () => {
  let journal = new PaintJournal()
  let brush = new PaintBrush(journal, smallField(), { radius: 0.3, hardness: 1, colour: RED }, localiseAsIs, asWritten)
  brush.moveTo(hitAt(10))
  expect(journal.count).toBe(1)
  brush.moveTo(hitAt(10.05))
  expect(journal.count).toBe(1)
  brush.moveTo(hitAt(11))
  expect(journal.count).toBe(1 + Math.floor(1 / 0.1))
  expect(brush.finish().dabs).toBe(journal.count)
  expect(journal.strokeCount).toBe(1)
})

test("a brush does not join samples on different parts", () => {
  let journal = new PaintJournal()
  let brush = new PaintBrush(journal, smallField(), { radius: 0.3, hardness: 1, colour: RED }, localiseAsIs, asWritten)
  brush.moveTo(hitAt(10, 0))
  brush.moveTo(hitAt(14, 1))
  expect(journal.count).toBe(2)
})

test("a field painted stroke by stroke equals one replayed from the journal", () => {
  let painted = smallField()
  let journal = new PaintJournal()
  let brush = new PaintBrush(journal, painted, { radius: 0.4, hardness: 0.3, colour: { r: 40, g: 200, b: 90, a: 200 } }, localiseAsIs, asWritten)
  for (let x = 10; x <= 12; x += 0.07) brush.moveTo(hitAt(x))
  brush.finish()
  let replayed = smallField()
  rasterise(journal, replayed, asWritten)
  expect(painted.pool).toEqual(replayed.pool)
})

// -- The file ------------------------------------------------------------------

test("paint.bin costs forty bytes a dab, and an empty journal writes nothing", () => {
  expect(PAINT_DAB_BYTES).toBe(DAB_BYTES)
  expect(writePaint(new PaintJournal())).toBe(undefined)
  let journal = journalWith([{ at: [1, 2, 3], radius: 0.5 }, { at: [4, 5, 6], radius: 0.25, hardness: 0.5, newStroke: true }])
  expect(writePaint(journal)!.length).toBe(32 + 2 * 40 + 2 * 4)
})

test("paint.bin comes back with every dab and stroke as it went in", () => {
  let journal = journalWith([{ at: [1, 2, 3], radius: 0.5 }, { at: [4, 5, 6], radius: 0.25, hardness: 0.5, newStroke: true }])
  let read = readPaint(writePaint(journal)!)
  expect(read.dabs).toBe(2)
  expect(read.strokes).toEqual([1, 2])
  expect([...read.centre]).toEqual([1, 2, 3, 4, 5, 6])
  expect([...read.radius]).toEqual([0.5, 0.25])
  let adopted = new PaintJournal()
  adopted.adopt(read)
  expect(adopted.count).toBe(2)
  expect(adopted.openStrokeCount).toBe(0)
})

test("paint.bin refuses a bad version, length, stroke end and radius", () => {
  let good = writePaint(journalWith([{ at: [1, 2, 3], radius: 0.5 }]))!
  let altered = (change: (view: DataView) => void, bytes = good.slice()) => {
    change(new DataView(bytes.buffer))
    return bytes
  }
  expect(() => readPaint(altered(v => v.setUint16(0, 9, true)))).toThrow("version 9")
  expect(() => readPaint(good.slice(0, good.length - 4))).toThrow("need")
  expect(() => readPaint(altered(v => v.setUint32(good.length - 4, 5, true)))).toThrow("stroke end")
  expect(() => readPaint(altered(v => v.setFloat32(32 + 24, -1, true)))).toThrow("radius")
})

test("a painted project carries its journal, and an unpainted one has no paint entry", async () => {
  let project = { parts: newModel(), palette: [], view: { mode: "marching-cubes" as const, resolution: 0.25 as const } }
  let plain = new ZipReader(await writeProject(project, new PaintJournal()))
  expect(plain.has("paint.bin")).toBe(false)
  expect(JSON.parse((await plain.textOf("manifest.json"))!).paint).toBe(undefined)
  let journal = journalWith([{ at: [0, 1, 0.7], normal: [0, 0, 1], radius: 0.2 }])
  let bytes = await writeProject(project, journal)
  let manifest = JSON.parse((await new ZipReader(bytes).textOf("manifest.json"))!)
  expect(manifest.paint).toEqual({ dabs: 1, strokes: 1 })
  let opened = await readProject(bytes)
  expect(opened.paint!.dabs).toBe(1)
  expect([...opened.paint!.centre].map(v => Math.round(v * 10) / 10)).toEqual([0, 1, 0.7])
})

test("a manifest naming paint the file does not have is refused", async () => {
  let bytes = await writeProject({ parts: newModel(), palette: [], view: { mode: "marching-cubes", resolution: 0.25 } })
  let zip = new ZipReader(bytes)
  let manifest = JSON.parse((await zip.textOf("manifest.json"))!)
  manifest.paint = { dabs: 3, strokes: 1 }
  let broken = await writeZip([
    { name: "manifest.json", data: JSON.stringify(manifest) },
    { name: "model.bin", data: (await zip.bytesOf("model.bin"))! },
  ])
  let refusal = ""
  try {
    await readProject(broken)
  } catch (reason) {
    refusal = String(reason)
  }
  expect(refusal).toContain("no paint.bin")
})

// -- End to end: a ray, the brush, the field -----------------------------------

const surfaceOf = (parts: readonly Part[]): BrushSurface => ({ field: new Field(parts), step: 0.1, parts })

const transformsOf = (parts: readonly Part[]) => ({
  localise: ((part, point, normal) => {
    let own = pointInPartFrame(parts[part]!, point)
    let turned = rotate(normal, conjugate(parts[part]!.orientation))
    return { centre: [own.x, own.y, own.z], normal: [turned.x, turned.y, turned.z] }
  }) as Localiser,
  place: (part: number, centre: Vec3, normal: Vec3): Placed | undefined => {
    let own = parts[part]
    if (own === undefined) return undefined
    let turned = rotate(centre, own.orientation)
    return { centre: { x: turned.x + own.origin.x, y: turned.y + own.origin.y, z: turned.z + own.origin.z }, normal: rotate(normal, own.orientation) }
  },
})

test("a ray at the capsule lands on its surface, on its part, facing the ray", () => {
  let parts = newModel()
  let hit = fieldHitAlong(surfaceOf(parts), { x: 0, y: 1.1, z: 10 }, { x: 0, y: 0, z: -1 })!
  expect(hit.point.z).toBeCloseTo(0.7, 2)
  expect(hit.part).toBe(0)
  expect(fieldHitAlong(surfaceOf(parts), { x: 0, y: 1.1, z: 10 }, { x: 0, y: 0, z: 1 })).toBe(undefined)
})

test("a stroke lands where the ray went, and moves with its part", () => {
  let parts = newModel()
  let f = PaintField.over(0.05, [-5, -5, -5], [12, 12, 12], 6)
  let journal = new PaintJournal()
  let { localise, place } = transformsOf(parts)
  let brush = new PaintBrush(journal, f, { radius: 0.2, hardness: 1, colour: RED }, localise, place)
  let hit = fieldHitAlong(surfaceOf(parts), { x: 0, y: 1.1, z: 10 }, { x: 0, y: 0, z: -1 })!
  brush.moveTo(hit)
  brush.finish()
  let [x, y, z] = f.voxelAt(hit.point.x, hit.point.y, hit.point.z)
  expect(f.get(x, y, z).a).toBeGreaterThan(200)
  // The part moves up a unit; a replay puts the paint a unit up too.
  let moved = [placedPart("body", parts[0]!.shape, { x: 0, y: 2.1, z: 0 })]
  f.clearAll()
  rasterise(journal, f, transformsOf(moved).place)
  expect(f.get(x, y, z).a).toBe(0)
  let [mx, my, mz] = f.voxelAt(hit.point.x, hit.point.y + 1, hit.point.z)
  expect(f.get(mx, my, mz).a).toBeGreaterThan(200)
})

test("undoing a stroke and replaying a cleared field takes the paint off", () => {
  let f = smallField()
  let journal = journalWith([{ at: [10, 10, 10], radius: 0.5 }, { at: [20, 10, 10], radius: 0.5, newStroke: true }])
  rasterise(journal, f, asWritten)
  journal.undoStroke()
  f.clearAll()
  rasterise(journal, f, asWritten)
  expect(f.get(100, 100, 100).a).toBe(255)
  expect(f.get(200, 100, 100).a).toBe(0)
})
