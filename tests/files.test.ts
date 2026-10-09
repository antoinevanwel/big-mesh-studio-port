import { test, expect } from "flux:test"
import { inflate } from "../src/file/inflate"
import { readProject, writeProject } from "../src/file/project"
import { deserialiseOperations, serialiseOperations } from "../src/file/serialise"
import { writeZip, ZipReader } from "../src/file/zip"
import { exportThreeMf } from "../src/print/print"
import { fromEuler, placedPart, type Part } from "../src/model/part"

const bytesOf = (base64: string): Uint8Array => Uint8Array.from(atob(base64), c => c.charCodeAt(0))

// A project as the web modeller writes it: the same two entries, DEFLATE-compressed.
const DEFLATED_PROJECT =
  "UEsDBBQAAAAIAOuCSV3wtGE/sgAAAJEBAAANAAAAbWFuaWZlc3QuanNvbo2QTQ6DIBBG957CsMbGMbV/V2m6QCGWRMUA2jTGu3fASCXddEPm8Q0vM8xJmpJJaCNVT24pUMeSG6zvWCJUir8JXeuBaZsBQXj4xlq1atSCh24I0cBaYa0IyexPDDReFXCkGzfI11PACvHyTZnrLkuPC/01AUBkKvJzpIIS/nbtpmj80zxS7YeOVGHnSYoXBquUdIq79UnHdP2UfZPVYyXM9pVaGNWOdv32/FA415IsyQdQSwMEFAAAAAgA64JJXSUMmTovAAAAZgAAAAkAAABtb2RlbC5iaW5jYWBiAAIwcfZMjz0DBmiwh8jxOBgbG9v///8fIsQMUl09IwunDiCwv5YQAuYCAFBLAQIUAxQAAAAIAOuCSV3wtGE/sgAAAJEBAAANAAAAAAAAAAAAAACAAQAAAABtYW5pZmVzdC5qc29uUEsBAhQDFAAAAAgA64JJXSUMmTovAAAAZgAAAAkAAAAAAAAAAAAAAIAB3QAAAG1vZGVsLmJpblBLBQYAAAAAAgACAHIAAAAzAQAAAAA="

// Raw deflate (dynamic Huffman blocks) of 120 generated lines.
const DEFLATED_TEXT =
  "XZZBjh0hDET3OcU/wE+EDcZwnFlmN8rM/ZXfv6ugGKl3T43twoX9+fHv+3d5fP39/np8fD/Kn1Kej+v79XkRE+LxfNjru4kLidcP/ny0m1Qh+fqnPh/zJm0Re8dpL3iTEHLFuUL5jbqgK1B/IWSXgq5IZaOxkL9D2T5wCrpi+crCiqAr1k7dTNAVq616bUtR37FiiWRV0BWrb2WboLhF518hKG/VGWur0d6xfGeYgvzWnXUNQXELTzVsCktIjxx96xHvaKK9mzCH+DjTXVjc6iMVr4IytADfivR3tLrK9hDkt/rswy4obvWZYgrKW33+tRVJtjxjTUHoeWRYiyA0PeqqJghdTznqlmOw7yljrcL8lL82YWx9nhnC0PtMZSsy2fssIAWh9+naIQi9D7HqFITeR4ptK2LlR/M3U4buR7TmytD+fCWqMvQ/amvyhBgNQE1aKIQFKGbrCuO8hZYK83yA2lbGnDZgPlMZbIA6oiiDDVB/mDL4ALqFaFNpBCQaVdnphGjKYAXGC2XwAvMUZRrNwHc5lXECQJgYCuEHShpTYZ6X0UWaWJbgg28K4Qnk010ZPIE6elUGT6D+Ltr0NRDAQhlcwUS7stMWPZWdM6GLNElfMM+pDL5AfVmUcSxAmDSFMMaahaLMWM4grAr9fJ6yKYxjLmcogzFQR4o2k75A/ZnKOB7AhjL4golOZacvhkzn8mNADFMGXyDP4crgC9Q3qjLOCAgztjBuNMZaMEKhn5cxusI4n6mRCvOY1EP2FqcxWMdUBl+g/lmUcVaAmTL4AolO0ab+8MWsys5pMZuyc1WaoQy+QH1ThGlrXnAxS4UwBiWdQ2GclzGnwjyfKSsiTtAaa+UzhX7sq1ZcIazBVaxUhRwahCJQpzm4+pVQeLrDSld4jg0rqfDcn6yIREmDrDqnQk4OSqSbb9IjVNd0+c3lkkVFpLFssk6uSv2Y5iZLsA/6ZG3coRA+oRCyCPtcE4QwFcIpK92h8LSKyTbsc8+Q/w=="

test("inflate decodes dynamic Huffman blocks byte for byte", () => {
  let text = new TextDecoder().decode(inflate(bytesOf(DEFLATED_TEXT)))
  let expected = Array.from({ length: 120 }, (_, i) => `part-${i} sits at ${(i * 0.25).toFixed(2)}, ${i % 7}, ${(i * i) % 13}\n`).join("")
  expect(text).toBe(expected)
})

test("a project the web modeller wrote opens, ids and colours intact", () => {
  let project = readProject(bytesOf(DEFLATED_PROJECT))
  expect(project.parts.map(part => part.id)).toEqual(["body", "part-1"])
  expect(project.parts[0]!.colour).toBe(undefined)
  expect(project.parts[1]!.colour).toEqual({ r: 214, g: 96, b: 84 })
  expect(project.parts[1]!.shape).toEqual({ type: "Sphere", radius: 0.5 })
  expect(project.view).toEqual({ mode: "marching-cubes", resolution: 0.25 })
  expect(project.palette.length).toBe(3)
})

test("a stored zip round-trips its entries", () => {
  let zip = new ZipReader(writeZip([{ name: "a.txt", data: "hello" }, { name: "dir/b.bin", data: new Uint8Array([1, 2, 3]) }]))
  expect(zip.textOf("a.txt")).toBe("hello")
  expect([...zip.bytesOf("dir/b.bin")!]).toEqual([1, 2, 3])
  expect(zip.has("missing")).toBe(false)
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

test("a project round-trips its parts, palette and view", () => {
  let parts = sample()
  let project = readProject(writeProject({ parts, palette: [{ r: 1, g: 2, b: 3, a: 4 }], view: { mode: "surface-nets", resolution: 0.125 } }))
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

test("a project that is not a zip is refused with a sentence", () => {
  expect(() => readProject(new Uint8Array([1, 2, 3, 4]))).toThrow("not a file a model was saved as")
})

test("a print is a closed solid of the asked height with one slot per corner", () => {
  let bytes = exportThreeMf(sample(), { heightMm: 80, maxColours: 2, title: "test & <figure>" })
  let zip = new ZipReader(bytes)
  expect(zip.has("[Content_Types].xml")).toBe(true)
  expect(zip.has("_rels/.rels")).toBe(true)
  let xml = zip.textOf("3D/3dmodel.model")!
  expect(xml).toContain('unit="millimeter"')
  expect(xml).toContain("test &amp; &lt;figure&gt;")
  let zs = [...xml.matchAll(/<vertex x="[^"]+" y="[^"]+" z="([^"]+)"/g)].map(m => Number(m[1]))
  expect(Math.min(...zs)).toBe(0)
  expect(Math.max(...zs)).toBeCloseTo(80, 2)
  expect([...xml.matchAll(/<m:color /g)].length).toBe(2)
})

test("an empty model is refused for printing", () => {
  expect(() => exportThreeMf([], { heightMm: 80, maxColours: 4, title: "x" })).toThrow("nothing in it to print")
})
