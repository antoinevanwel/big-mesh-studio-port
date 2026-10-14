import { file } from "flux:fs"
import { test, expect } from "@solidrt/test"
import { isolate } from "flux:isolate"
import { ZipReader } from "../src/file/zip"
import type * as Mesher from "../src/mesher"
import { newModel } from "../src/model/part"

type App = Parameters<Parameters<typeof test>[1]>[0]

// A rebuild waits for the model to be still for 90 ms, and settle() does
// not wait for a timer that is not yet due: let that time pass first.
const rest = async (app: App) => {
  await app.advance(200)
  await app.settle()
}

// A workaround for SolidRT: settle() waits for an isolate call but not for
// an isolate stream between its steps, and an app test has no wall clock to
// wait on (SOLIDRT-FEEDBACK.md, "settle() does not wait for an isolate stream").
// Real time passes while the test awaits real work, so small meshes in an
// isolate of the test's own are the wait, a frame played after each. Not a
// settle: each progress step the stream brings retargets the progress bar's
// glide, so the app is not at rest while the work runs, and settle() throws
// once the work outlasts its 5000 ms of app time. Settled once done.
// Revert to rest(app) once settle() counts an open stream as in flight.
const restUntil = async (app: App, done: () => boolean) => {
  let clock = isolate<typeof Mesher>("mesher")
  try {
    for (let i = 0; i < 400 && !done(); i++) {
      await clock.mesh(newModel(), 0.5, "surface-nets")
      await app.frame(1)
    }
  } finally {
    clock.terminate()
  }
  await rest(app)
}

//Usually you import dependencies at the top, this is an exception
const start = async (app: App) => {
  let root = await app.load(() => import("@/index.tsx"))
  await rest(app)
  return root
}

test("the modeller starts with a capsule, meshed watertight", async app => {
  let root = await start(app)
  expect(root.find({ text: "sdf-modeller" }).visible).toBe(true)
  expect(root.find({ text: /^1 part · .* watertight/ }).visible).toBe(true)
  expect(root.find({ text: "body" }).visible).toBe(true)
})

test("adding a primitive lists it, selects it and re-meshes", async app => {
  let root = await start(app)
  await app.tap(root.find({ text: "Torus" }))
  await rest(app)
  expect(root.find({ text: "part-1" }).visible).toBe(true)
  expect(root.find({ text: "Major radius" }).visible).toBe(true)
  expect(root.find({ text: /^2 parts · / }).visible).toBe(true)
})

test("undo takes an added part back out, redo puts it back", async app => {
  let root = await start(app)
  await app.tap(root.find({ text: "Cone" }))
  await rest(app)
  await app.tap(root.find({ text: "Undo" }))
  await rest(app)
  expect(root.find({ text: "part-1" }).exists).toBe(false)
  expect(root.find({ text: /^1 part · / }).visible).toBe(true)
  await app.tap(root.find({ text: "Redo" }))
  await rest(app)
  expect(root.find({ text: /^2 parts · / }).visible).toBe(true)
})

test("a difference is reported in the panel and keeps the mesh closed", async app => {
  let root = await start(app)
  await app.tap(root.find({ text: "Box" }))
  await rest(app)
  await app.tap(root.find({ text: "Difference" }))
  await rest(app)
  expect(root.find({ text: "hard edge" }).visible).toBe(true)
  expect(root.find({ text: /watertight/ }).visible).toBe(true)
})

test("the files dialog saves the model and lists it", async app => {
  let root = await start(app)
  await app.tap(root.find({ text: "Files" }))
  await rest(app)
  await app.tap(root.find({ text: "Save" }))
  await rest(app)
  expect(root.find({ text: "1 part" }).visible).toBe(true)
  // The name heads the dialog, fills the name field and labels the new card.
  expect(root.findAll({ text: "model" }).length).toBe(3)
  expect(root.find({ text: "Delete" }).visible).toBe(true)
})

test("an export writes a 3mf whose model is deflated", async app => {
  let root = await start(app)
  await app.tap(root.find({ text: "Files" }))
  await rest(app)
  await app.tap(root.find({ text: "Export .3mf" }))
  await restUntil(app, () => root.find({ text: /^written to / }).exists)
  expect(root.find({ text: /^written to .*model\.3mf$/ }).visible).toBe(true)
  let bytes = await file("exports/model.3mf").bytes()
  let xml = (await new ZipReader(bytes).textOf("3D/3dmodel.model"))!
  expect(xml).toContain('unit="millimeter"')
  expect(bytes.length).toBeLessThan(xml.length / 3)
})

test("a tap on empty space deselects, a tap on the model selects again", async app => {
  let root = await start(app)
  expect(root.find({ text: "body" }).visible).toBe(true)
  await app.tap({ x: 640, y: 40 })
  await rest(app)
  expect(root.find({ text: "body" }).exists).toBe(false)
  await app.tap({ x: 640, y: 380 })
  await rest(app)
  expect(root.find({ text: "body" }).visible).toBe(true)
})

test("duplicate copies the selected part and selects the copy", async app => {
  let root = await start(app)
  await app.tap(root.find({ text: "Duplicate" }))
  await rest(app)
  expect(root.find({ text: /^2 parts · / }).visible).toBe(true)
  expect(root.find({ text: "part-1" }).visible).toBe(true)
  await app.tap(root.find({ text: "Undo" }))
  await rest(app)
  expect(root.find({ text: /^1 part · / }).visible).toBe(true)
})

test("dragging a ring turns the part, as one undo step", async app => {
  let root = await start(app)
  await app.tap(root.find({ text: "Rotate" }))
  await rest(app)
  // Three rotation fields read 0.0 while the capsule stands upright.
  expect(root.findAll({ text: "0.0" }).length).toBe(3)
  // The x and z rings both pass through the point straight above the part,
  // which lands about 269 px above the window's centre (the part's centre
  // on screen) under this camera; a drag sideways from there turns it.
  await app.drag({ x: 640, y: 91 }, { x: 760, y: 110 }, { durationMs: 200 })
  await rest(app)
  expect(root.findAll({ text: "0.0" }).length).toBeLessThan(3)
  await app.tap(root.find({ text: "Undo" }))
  await rest(app)
  expect(root.findAll({ text: "0.0" }).length).toBe(3)
})

test("a paint stroke lands on the model, as one undo step, and survives a save", async app => {
  let root = await start(app)
  // The first mouse move turns the components' policy from touch to
  // desktop, which narrows the buttons and reflows the tool row; let that
  // happen before tapping Paint (wrapped onto the next row until then).
  await app.input([{ type: "pointer", action: "move", x: 640, y: 700 }])
  await rest(app)
  await app.tap(root.find({ text: "Paint" }))
  await rest(app)
  // Across the capsule's middle, which stands at the window's centre.
  await app.drag({ x: 600, y: 420 }, { x: 680, y: 430 }, { durationMs: 200 })
  await rest(app)
  // The brush panel sits below the shape panel, scrolled out of this window.
  let readout = root.find({ text: /paint texels a world unit · \d+ dabs$/ })
  expect(readout.exists).toBe(true)
  let dabs = Number(/(\d+) dabs$/.exec(readout.text!)![1])
  expect(dabs).toBeGreaterThan(1)
  await app.tap(root.find({ text: "Files" }))
  await rest(app)
  await app.tap(root.find({ text: "Save" }))
  await rest(app)
  let saved = await new ZipReader(await file("models/model.sdfmod").bytes()).textOf("manifest.json")
  expect(JSON.parse(saved!).paint).toEqual({ dabs, strokes: 1 })
  await app.tap(root.find({ text: "Close" }))
  await rest(app)
  await app.tap(root.find({ text: "Undo" }))
  await rest(app)
  expect(root.find({ text: /· 0 dabs$/ }).exists).toBe(true)
})
