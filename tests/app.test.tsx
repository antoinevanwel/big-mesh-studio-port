import { test, expect } from "@solidrt/test"

type App = Parameters<Parameters<typeof test>[1]>[0]

// A rebuild waits for the model to be still for 90 ms, and settle() does
// not wait for a timer that is not yet due: let that time pass first.
const rest = async (app: App) => {
  await app.advance(200)
  await app.settle()
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
