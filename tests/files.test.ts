import { test, expect } from "flux:test"
import { readProject, writeProject } from "../src/file/project"
import { deserialiseOperations, serialiseOperations } from "../src/file/serialise"
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

test("the operation format refuses another version", () => {
  let bytes = serialiseOperations([])
  bytes[0] = 3
  expect(() => deserialiseOperations(bytes)).toThrow("version 3")
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
