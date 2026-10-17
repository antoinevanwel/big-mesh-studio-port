import { test, expect } from "flux:test"
import { dir, file } from "flux:fs"
import { writeModelInStorage } from "../src/file/library"
import { forgetFile, listRecentFiles, rememberFile } from "../src/file/recent-files"
import { readProject, writeProject } from "../src/file/project"
import { deserialiseOperations, FORMAT_VERSION, serialiseOperations, type Operation } from "../src/file/serialise"
import { writeZip, ZipReader } from "../src/file/zip"
import { describePrintEstimate, exportThreeMf, exportThreeMfSteps, PRINT_MAX_SAMPLES_PER_AXIS, printEstimate } from "../src/print/print"
import { fromEuler, placedPart, type Part } from "../src/model/part"

const bytesOf = (base64: string): Uint8Array => Uint8Array.from(atob(base64), c => c.charCodeAt(0))

// A project as the web modeller writes it: the same two entries, DEFLATE-compressed.
const DEFLATED_PROJECT =
  "UEsDBBQAAAAIAOuCSV3wtGE/sgAAAJEBAAANAAAAbWFuaWZlc3QuanNvbo2QTQ6DIBBG957CsMbGMbV/V2m6QCGWRMUA2jTGu3fASCXddEPm8Q0vM8xJmpJJaCNVT24pUMeSG6zvWCJUir8JXeuBaZsBQXj4xlq1atSCh24I0cBaYa0IyexPDDReFXCkGzfI11PACvHyTZnrLkuPC/01AUBkKvJzpIIS/nbtpmj80zxS7YeOVGHnSYoXBquUdIq79UnHdP2UfZPVYyXM9pVaGNWOdv32/FA415IsyQdQSwMEFAAAAAgA64JJXSUMmTovAAAAZgAAAAkAAABtb2RlbC5iaW5jYWBiAAIwcfZMjz0DBmiwh8jxOBgbG9v///8fIsQMUl09IwunDiCwv5YQAuYCAFBLAQIUAxQAAAAIAOuCSV3wtGE/sgAAAJEBAAANAAAAAAAAAAAAAACAAQAAAABtYW5pZmVzdC5qc29uUEsBAhQDFAAAAAgA64JJXSUMmTovAAAAZgAAAAkAAAAAAAAAAAAAAIAB3QAAAG1vZGVsLmJpblBLBQYAAAAAAgACAHIAAAAzAQAAAAA="

test("a project the web modeller wrote opens, ids and colours intact", async () => {
  let project = await readProject(bytesOf(DEFLATED_PROJECT))
  expect(project.parts.map(part => part.id)).toEqual(["body", "part-1"])
  expect(project.parts[0]!.colour).toBe(undefined)
  expect(project.parts[1]!.colour).toEqual({ r: 214, g: 96, b: 84 })
  expect(project.parts[1]!.shape).toEqual({ type: "Sphere", radius: 0.5 })
  expect(project.view).toEqual({ mode: "marching-cubes", resolution: 0.25 })
  expect(project.palette.length).toBe(3)
})

test("a zip round-trips its entries", async () => {
  let zip = new ZipReader(await writeZip([{ name: "a.txt", data: "hello" }, { name: "dir/b.bin", data: new Uint8Array([1, 2, 3]) }]))
  expect(await zip.textOf("a.txt")).toBe("hello")
  expect([...(await zip.bytesOf("dir/b.bin"))!]).toEqual([1, 2, 3])
  expect(zip.has("missing")).toBe(false)
})

// The compression method of each entry, read from the central directory.
const methods = (bytes: Uint8Array): number[] => {
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = bytes.length - 22
  let at = view.getUint32(end + 16, true)
  let found: number[] = []
  for (let i = 0; i < view.getUint16(end + 10, true); i++) {
    found.push(view.getUint16(at + 10, true))
    at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
  }
  return found
}

test("a zip deflates what shrinks and stores what does not", async () => {
  let text = Array.from({ length: 2000 }, (_, i) => `<vertex x="${i % 17}" y="${i % 5}" z="0" />\n`).join("")
  let noise = Uint8Array.from({ length: 4096 }, () => Math.floor(Math.random() * 256))
  let bytes = await writeZip([{ name: "model.xml", data: text }, { name: "noise.bin", data: noise }])
  expect(methods(bytes)).toEqual([8, 0])
  expect(bytes.length).toBeLessThan(text.length / 4 + noise.length + 200)
  let zip = new ZipReader(bytes)
  expect(await zip.textOf("model.xml")).toBe(text)
  expect([...(await zip.bytesOf("noise.bin"))!]).toEqual([...noise])
})

const sample = (): Part[] => [
  placedPart("body", { type: "Capsule", len: 2.2, radius: 0.7 }, { x: 0, y: 1.1, z: 0 }),
  placedPart("arm", { type: "RoundBox", len: { x: 0.5, y: 0.25, z: 0.25 }, radius: 0.1 }, { x: 1, y: 1.5, z: 0 }, {
    orientation: fromEuler(0.5, 0.25, 0),
    softness: 0.1,
    colour: { r: 10, g: 200, b: 30 },
    opacity: 0.5,
  }),
  placedPart("hole", { type: "Torus", majorRadius: 0.5, minorRadius: 0.125 }, { x: 0, y: 2, z: 0.5 }, { combine: "Subtract" }),
]

test("a project round-trips its parts, palette and view", async () => {
  let parts = sample()
  let project = await readProject(await writeProject({ parts, palette: [{ r: 1, g: 2, b: 3, a: 4 }], view: { mode: "surface-nets", resolution: 0.125 } }))
  expect(project.view).toEqual({ mode: "surface-nets", resolution: 0.125 })
  expect(project.palette).toEqual([{ r: 1, g: 2, b: 3, a: 4 }])
  expect(project.parts.map(part => [part.id, part.combine, part.colour ?? null])).toEqual([
    ["body", "Add", null],
    ["arm", "Add", { r: 10, g: 200, b: 30 }],
    ["hole", "Subtract", null],
  ])
  expect(project.parts[1]!.opacity).toBeCloseTo(0.5, 6)
  expect(project.parts[1]!.orientation.w).toBeCloseTo(parts[1]!.orientation.w, 6)
  expect(project.parts[2]!.shape).toEqual({ type: "Torus", majorRadius: 0.5, minorRadius: 0.125 })
})

test("the operation format refuses a version it cannot read", () => {
  // Version 2's bytes parse but mean something else; 6 is from a later build.
  for (let version of [2, 6]) {
    let bytes = serialiseOperations([])
    bytes[0] = version
    expect(() => deserialiseOperations(bytes)).toThrow(`version ${version}`)
  }
})

const operationsOf = (parts: readonly Part[]): Operation[] =>
  parts.map(part => ({ combine: part.combine, shape: part.shape, origin: part.origin, orientation: part.orientation, softness: part.softness, opacity: part.opacity ?? 1, ...(part.colour == null ? {} : { colour: part.colour }) }))

const square = (half: number) => [
  { x: -half, z: -half },
  { x: half, z: -half },
  { x: half, z: half },
  { x: -half, z: half },
]

test("a model without a polygon is written at version 4, and one with a polygon at 5", () => {
  let fixed = operationsOf(sample())
  expect(new DataView(serialiseOperations(fixed).buffer).getUint16(0, true)).toBe(4)
  expect(new DataView(serialiseOperations([]).buffer).getUint16(0, true)).toBe(4)
  let floor = operationsOf([placedPart("floor", { type: "Polygon", points: square(2), len: 0.2 }, { x: 0, y: 0, z: 0 })])
  expect(new DataView(serialiseOperations([...fixed, ...floor]).buffer).getUint16(0, true)).toBe(FORMAT_VERSION)
})

test("a version 3 file, one byte shorter per operation, reads as the same model", () => {
  let operations = operationsOf(sample())
  // Each operation written alone, its header and its material byte cut off.
  let records = operations.map(operation => serialiseOperations([operation]).slice(6, -1))
  let bytes = new Uint8Array(6 + records.reduce((sum, record) => sum + record.length, 0))
  let view = new DataView(bytes.buffer)
  view.setUint16(0, 3, true)
  view.setUint32(2, records.length, true)
  let at = 6
  for (let record of records) {
    bytes.set(record, at)
    at += record.length
  }
  let read = deserialiseOperations(bytes)
  expect(read.map(operation => operation.shape)).toEqual(deserialiseOperations(serialiseOperations(operations)).map(operation => operation.shape))
  expect(read[1]!.colour).toEqual({ r: 10, g: 200, b: 30 })
  expect(read.every(operation => !("material" in operation))).toBe(true)
})

test("a polygon round-trips between fixed shapes without shifting one", () => {
  let triangle = [
    { x: 0, z: -1 },
    { x: 1, z: 1 },
    { x: -1, z: 1 },
  ]
  let parts = [
    placedPart("a", { type: "Box", len: { x: 0.5, y: 0.25, z: 0.75 } }, { x: 1, y: 2, z: 3 }),
    placedPart("floor", { type: "Polygon", points: triangle, len: 0.25 }, { x: 0, y: 0, z: 0 }, { colour: { r: 1, g: 2, b: 3 } }),
    placedPart("b", { type: "Capsule", len: 1.5, radius: 0.25 }, { x: -1, y: 0, z: 0 }),
    placedPart("roof", { type: "Polygon", points: square(2), len: 0.5 }, { x: 0, y: 3, z: 0 }),
  ]
  let read = deserialiseOperations(serialiseOperations(operationsOf(parts)))
  expect(read.map(operation => operation.shape)).toEqual(parts.map(part => part.shape))
  expect(read[1]!.colour).toEqual({ r: 1, g: 2, b: 3 })
  expect(read[2]!.origin).toEqual({ x: -1, y: 0, z: 0 })
})

test("a polygon in an older file, or one claiming too many points, is refused", () => {
  let bytes = serialiseOperations(operationsOf([placedPart("floor", { type: "Polygon", points: square(1), len: 0.5 }, { x: 0, y: 0, z: 0 })]))
  let older = bytes.slice()
  older[0] = 4
  expect(() => deserialiseOperations(older)).toThrow("carries its own width")
  // The point count, the first parameter after the 40 fixed bytes, claims a
  // billion: clamped to the table's 64, which this file cannot supply.
  let hostile = bytes.slice()
  new DataView(hostile.buffer).setFloat32(6 + 34, 1e9, true)
  expect(() => deserialiseOperations(hostile)).toThrow("runs past the end")
})

test("a project that is not a zip is refused with a sentence", async () => {
  await expect(readProject(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow("not a file a model was saved as")
})

test("a print is a closed solid of the asked height with one slot per corner", async () => {
  let bytes = await exportThreeMf(sample(), { heightMm: 80, maxColours: 2, title: "test & <figure>" })
  let zip = new ZipReader(bytes)
  expect(zip.has("[Content_Types].xml")).toBe(true)
  expect(zip.has("_rels/.rels")).toBe(true)
  let xml = (await zip.textOf("3D/3dmodel.model"))!
  expect(xml).toContain('unit="millimeter"')
  expect(xml).toContain("test &amp; &lt;figure&gt;")
  let zs = [...xml.matchAll(/<vertex x="[^"]+" y="[^"]+" z="([^"]+)"/g)].map(m => Number(m[1]))
  expect(Math.min(...zs)).toBe(0)
  expect(Math.max(...zs)).toBeCloseTo(80, 2)
  expect([...xml.matchAll(/<m:color /g)].length).toBe(2)
})

test("an empty model is refused for printing", async () => {
  await expect(exportThreeMf([], { heightMm: 80, maxColours: 4, title: "x" })).rejects.toThrow("nothing in it to print")
})

const ball = (): Part[] => [placedPart("ball", { type: "Sphere", radius: 0.4 }, { x: 0, y: 0, z: 0 })]
const trianglesIn = async (bytes: Uint8Array): Promise<number> => [...(await new ZipReader(bytes).textOf("3D/3dmodel.model"))!.matchAll(/<triangle /g)].length

test("a finer print resolution makes a finer print, and one outside the range is refused", async () => {
  let coarse = await trianglesIn(await exportThreeMf(ball(), { heightMm: 40, maxColours: 1, title: "ball" }))
  let fine = await trianglesIn(await exportThreeMf(ball(), { heightMm: 40, maxColours: 1, title: "ball", voxelSize: 0.03125 }))
  expect(fine).toBeGreaterThan(coarse * 3)
  await expect(exportThreeMf(ball(), { heightMm: 40, maxColours: 1, title: "ball", voxelSize: 0.125 })).rejects.toThrow("a print meshes between")
  await expect(exportThreeMf(ball(), { heightMm: 40, maxColours: 1, title: "ball", voxelSize: 0.001 })).rejects.toThrow("a print meshes between")
})

test("an export streams rising progress, then the file", async () => {
  let progress: number[] = []
  let bytes: Uint8Array | undefined
  for await (let step of exportThreeMfSteps(ball(), { heightMm: 40, maxColours: 1, title: "ball" })) {
    if ("bytes" in step) bytes = step.bytes
    else progress.push(step.progress)
  }
  expect(progress.length).toBeGreaterThan(10)
  expect(progress.every((value, i) => i === 0 || value >= progress[i - 1]!)).toBe(true)
  expect(progress[progress.length - 1]).toBe(1)
  expect(bytes !== undefined && bytes.length > 0).toBe(true)
})

test("the print estimate says what a resolution costs, and when the cap holds it back", () => {
  let fine = printEstimate(ball(), 0.015625)!
  let coarse = printEstimate(ball(), 0.0625)!
  expect(fine.samples).toBeGreaterThan(coarse.samples)
  expect(fine.seconds).toBeGreaterThan(coarse.seconds)
  expect(/^\d+ samples across · about \d+k? triangles · about [\d.]+ s$/.test(describePrintEstimate(coarse))).toBe(true)
  let big = printEstimate([placedPart("slab", { type: "Box", len: { x: 20, y: 20, z: 20 } }, { x: 0, y: 0, z: 0 })], 0.015625)!
  expect(big.samples).toBe(PRINT_MAX_SAMPLES_PER_AXIS)
  expect(big.capped).toBe(true)
  expect(describePrintEstimate(big)).toContain(`capped at ${PRINT_MAX_SAMPLES_PER_AXIS}`)
})

// The storage the next two tests use is shared by this file's tests: start
// and end with none of it.
const clearStorage = async () => {
  for (let folder of ["models", "exports"]) {
    if (!(await dir(folder).exists())) continue
    for (let entry of await dir(folder).entries()) if (entry.type === "file") await file(entry.path).remove()
  }
  if (await file("recent.json").exists()) await file("recent.json").remove()
}

test("without a dialog, Save never writes over an earlier model", async () => {
  await clearStorage()
  let project = await writeProject({ parts: [], palette: [], view: { mode: "marching-cubes", resolution: 0.25 } })
  let first = await writeModelInStorage("model.sdfmod", project)
  let second = await writeModelInStorage("model.sdfmod", project)
  expect([first.path, second.path]).toEqual(["models/model.sdfmod", "models/model (1).sdfmod"])
  expect(second.name).toBe("model (1).sdfmod")
  await clearStorage()
})

test("the models the port kept before it had dialogs become the remembered list", async () => {
  await clearStorage()
  let one = await writeProject({ parts: [placedPart("ball", { type: "Sphere", radius: 0.5 }, { x: 0, y: 0, z: 0 })], palette: [], view: { mode: "marching-cubes", resolution: 0.25 } })
  await dir("models").create()
  await file("models/ball.sdfmod").write(one)
  let seeded = await listRecentFiles()
  expect(seeded.map(entry => [entry.path, entry.name, entry.parts])).toEqual([["models/ball.sdfmod", "ball.sdfmod", 1]])
  // Seeded once: a forgotten model stays forgotten, and stays on disk.
  await forgetFile("models/ball.sdfmod")
  expect(await listRecentFiles()).toEqual([])
  expect(await file("models/ball.sdfmod").exists()).toBe(true)
  await rememberFile("elsewhere/ball.sdfmod", "ball.sdfmod", 1)
  await rememberFile("elsewhere/ball.sdfmod", "ball.sdfmod", 2)
  expect((await listRecentFiles()).map(entry => entry.parts)).toEqual([2])
  await clearStorage()
})
