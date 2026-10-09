// The modeller: the 3D view, the parts list and primitive picker, the
// selected part's panel, the tools, the mesher controls, undo, and the
// files dialog. Ported from big-mesh-studios' apps/sdf-modeller app.tsx.
//
// The mesh is the result of the model, never the model: an edit changes
// the parts at once and the mesh follows from the mesher isolate after the
// model has been still for REBUILD_MS, so a drag or a run of typing is one
// rebuild rather than one per change.
//
// Wide windows lay the panels over the view (the parts on the left, the
// selected part on the right); a compact one stacks the view above one
// panel at a time, chosen by tabs, so the two can never overlap.

import { capabilities, createEffect, createMemo, createSignal, onSettled, pct, Show, textInputActive, windowSize, type KeyEvent } from "@solidrt/core"
import { Button, Card, Modal, ScrollView, SegmentedControl, Slider, Text, View } from "@solidrt/components"
import { isolate } from "flux:isolate"
import { cleanName, clearDraft, deleteModel, listModels, modelExists, readDraft, readModel, saveDraft, saveModel, writeExport, type SavedModel } from "../file/library"
import { readProject, writeProject, type Project } from "../file/project"
import { DEFAULT_MESH_MODE, DEFAULT_RESOLUTION, MESH_MODES, RESOLUTIONS, type MeshMode, type Resolution } from "../mesh/mesh-model"
import { describeReport } from "../mesh/report"
import type * as Mesher from "../mesher"
import type { ViewMesh } from "../mesher"
import { nearestPart } from "../model/field"
import { createModelStore } from "../model/model-store"
import { createPalette, STARTER_PALETTE } from "../model/palette"
import { modelBounds, newModel, type Part } from "../model/part"
import type { Vec3 } from "../model/types"
import { DEFAULT_HEIGHT_MM, DEFAULT_MAX_COLOURS } from "../print/print"
import { registerShortcuts } from "../state"
import { PANEL, QUIET } from "../theme"
import { FilesPanel } from "../ui/files-panel"
import { PartsPanel } from "../ui/parts-panel"
import { TransformPanel } from "../ui/transform-panel"
import { Viewport } from "../view/viewport"

/** How long the model has to be still before it is re-meshed, in ms. */
const REBUILD_MS = 90
/** How long after a rebuild the draft is written, in ms. */
const AUTOSAVE_MS = 1000

// Two mesher instances: the model's rebuilds queue on one, so a drag ghost
// or an export never waits behind a fine-resolution rebuild.
const mesher = isolate<typeof Mesher>("mesher")
const side = isolate<typeof Mesher>("mesher")

type Tool = "select" | "move"
type Frame = { centre: Vec3; size: number }

const message = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason))

export function Modeller() {
  let store = createModelStore(newModel())
  let palette = createPalette(STARTER_PALETTE)
  let [tool, setTool] = createSignal<Tool>("select")
  let [mode, setMode] = createSignal<MeshMode>(DEFAULT_MESH_MODE)
  let [resolution, setResolution] = createSignal<Resolution>(DEFAULT_RESOLUTION)
  let [sheet, setSheet] = createSignal<"parts" | "shape">("parts")
  let [status, setStatus] = createSignal("meshing…")
  let [mesh, setMesh] = createSignal<ViewMesh | undefined>()
  let [frame, setFrame] = createSignal<Frame | undefined>(undefined, {
    equals: (a, b) => a === b || (a !== undefined && b !== undefined && a.size === b.size && a.centre.x === b.centre.x && a.centre.y === b.centre.y && a.centre.z === b.centre.z),
  })

  // The document's home in models/ (undefined: never saved) and the files dialog.
  let [home, setHome] = createSignal<string | undefined>()
  let [filesOpen, setFilesOpen] = createSignal(false)
  let [models, setModels] = createSignal<readonly SavedModel[]>([])
  let [draftAt, setDraftAt] = createSignal<number | undefined>()
  let [busy, setBusy] = createSignal(false)
  let [notice, setNotice] = createSignal<string | undefined>()
  let [exported, setExported] = createSignal<string | undefined>()
  let [heightMm, setHeightMm] = createSignal(DEFAULT_HEIGHT_MM)
  let [filaments, setFilaments] = createSignal(DEFAULT_MAX_COLOURS)
  let replacing: string | undefined

  let selected = createMemo((): Part | undefined => {
    let id = store.selected()
    return id === undefined ? undefined : store.parts().find(part => part.id === id)
  })
  let wide = () => capabilities.windowSizeClass !== "compact"

  // -- Rebuilds: debounced, one in flight, the latest model next --------------

  type Job = { parts: readonly Part[]; mode: MeshMode; resolution: Resolution }
  let requested: Job | undefined
  let running = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let restored = false

  let run = async () => {
    if (running || requested === undefined || disposed) return
    let job = requested
    requested = undefined
    running = true
    try {
      let result = await mesher.mesh(job.parts as Part[], job.resolution, job.mode)
      if (!disposed) install(job, result)
    } catch (reason) {
      setStatus(`meshing failed: ${message(reason)}`)
    } finally {
      running = false
      if (requested !== undefined) void run()
    }
  }

  let install = (job: Job, result: ViewMesh | null) => {
    setMesh(result ?? undefined)
    let bounds = modelBounds(job.parts)
    if (bounds !== undefined) {
      setFrame({
        centre: { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2, z: (bounds.min.z + bounds.max.z) / 2 },
        size: Math.max(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z),
      })
    }
    let count = job.parts.length
    setStatus(
      result === null
        ? "no parts yet — add one"
        : `${count} part${count === 1 ? "" : "s"} · ${result.triangles} triangles · ${Math.round(result.samples / 1000)}k samples · ${Math.round(result.ms)} ms · ${describeReport(result.report)}`,
    )
    armDraft()
  }

  createEffect(
    () => ({ parts: store.parts(), mode: mode(), resolution: resolution() }),
    job => {
      requested = job
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        void run()
      }, REBUILD_MS)
    },
  )

  // -- The document on disk ---------------------------------------------------

  let project = (): Project => ({ parts: store.parts(), palette: palette.colours(), view: { mode: mode(), resolution: resolution() } })

  let draftTimer: ReturnType<typeof setTimeout> | undefined
  let armDraft = () => {
    if (!restored) return
    if (draftTimer !== undefined) clearTimeout(draftTimer)
    draftTimer = setTimeout(() => {
      let at = Date.now()
      void saveDraft(writeProject(project()), at).then(
        () => setDraftAt(at),
        () => {},
      )
    }, AUTOSAVE_MS)
  }

  let loadInto = (opened: Project, label: string): boolean => {
    setMode(opened.view.mode)
    setResolution(opened.view.resolution)
    palette.set(opened.palette)
    return store.load(opened.parts, label)
  }

  let refreshModels = async () => setModels(await listModels())

  /** Runs a file action, putting its refusal where the dialog shows it. */
  let attempt = async (action: () => Promise<void>) => {
    setNotice(undefined)
    setBusy(true)
    try {
      await action()
    } catch (reason) {
      setNotice(message(reason))
    } finally {
      setBusy(false)
    }
  }

  let save = (typed: string) =>
    attempt(async () => {
      let name = cleanName(typed)
      if (name === "") throw new Error("a model needs a name to be saved under")
      if (name !== home() && replacing !== name && (await modelExists(name))) {
        replacing = name
        throw new Error(`a model called ${name} already exists — Save again to replace it`)
      }
      replacing = undefined
      await saveModel(name, writeProject(project()))
      setHome(name)
      setStatus(`saved as ${name}`)
      await refreshModels()
    })

  let open = (name: string) =>
    attempt(async () => {
      let opened = readProject(await readModel(name))
      if (!loadInto(opened, `open ${name}`)) throw new Error("this file holds more parts than the limit, or two parts with one id")
      setHome(name)
      setExported(undefined)
      setFilesOpen(false)
      setStatus(`opened ${name}`)
    })

  let remove = (name: string) =>
    attempt(async () => {
      await deleteModel(name)
      if (home() === name) setHome(undefined)
      await refreshModels()
    })

  let startOver = () =>
    attempt(async () => {
      await clearDraft()
      setDraftAt(undefined)
      palette.set([])
      setHome(undefined)
      setExported(undefined)
      store.load(newModel(), "new model")
      setStatus("new model")
    })

  let exportPrint = () =>
    attempt(async () => {
      let name = home() ?? "model"
      let bytes = await side.exportThreeMf(store.parts() as Part[], { heightMm: heightMm(), maxColours: filaments(), title: name })
      setExported(await writeExport(name, bytes))
    })

  // A draft is restored silently, as every editor worth using does; one
  // this build cannot read is thrown away rather than refused on every start.
  onSettled(() => {
    void (async () => {
      try {
        let draft = await readDraft()
        if (draft !== undefined && !disposed) {
          if (loadInto(readProject(draft.bytes), "restore")) {
            setDraftAt(draft.at || undefined)
            setStatus("restored from this app")
          }
        }
      } catch {
        await clearDraft().catch(() => {})
      }
      restored = true
      await refreshModels().catch(() => {})
    })()
    return () => {
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
      if (draftTimer !== undefined) clearTimeout(draftTimer)
    }
  })

  // -- Shortcuts --------------------------------------------------------------

  onSettled(() =>
    registerShortcuts((e: KeyEvent) => {
      let key = e.key.toLowerCase()
      let command = e.ctrlKey || e.metaKey
      if (command && key === "z") e.shiftKey ? store.redo() : store.undo()
      else if (command && key === "y") store.redo()
      else if (command && key === "s") {
        setFilesOpen(true)
        void refreshModels()
      } else if (textInputActive()) return
      else if (key === "delete" || key === "backspace") {
        let part = selected()
        if (part !== undefined) store.remove(part.id)
      } else if (key === "escape") {
        if (filesOpen()) setFilesOpen(false)
        else setTool("select")
      } else if (key === "v") setTool("select")
      else if ((key === "g" || key === "m") && selected() !== undefined) setTool("move")
    }),
  )

  // -- The pieces of the shell ------------------------------------------------

  let Header = () => (
    <View layout={{ gap: 2 }}>
      <Text variant="label">sdf-modeller</Text>
      <Text variant="caption" style={{ color: QUIET }}>
        {status()}
      </Text>
    </View>
  )

  let Tools = () => (
    <View layout={{ flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <Button variant={tool() === "select" ? "primary" : "secondary"} onPress={() => setTool("select")}>
        Select
      </Button>
      <Button variant={tool() === "move" ? "primary" : "secondary"} disabled={selected() === undefined} onPress={() => setTool("move")}>
        Move
      </Button>
      <SegmentedControl options={MESH_MODES.map(m => ({ value: m.value, label: m.label }))} value={mode()} onChange={setMode} layout={{ width: 128 }} />
    </View>
  )

  let ResolutionRow = () => (
    <View layout={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
      <Text variant="caption" muted layout={{ width: 92 }}>{`resolution ${resolution()}`}</Text>
      <Slider
        min={0}
        max={RESOLUTIONS.length - 1}
        step={1}
        value={RESOLUTIONS.indexOf(resolution())}
        onChange={index => setResolution(RESOLUTIONS[Math.round(index)] ?? DEFAULT_RESOLUTION)}
        layout={{ flexGrow: 1, minWidth: 96 }}
      />
    </View>
  )

  let Footer = () => (
    <View layout={{ flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <Button variant="secondary" disabled={!store.canUndo()} onPress={store.undo}>
        Undo
      </Button>
      <Button variant="secondary" disabled={!store.canRedo()} onPress={store.redo}>
        Redo
      </Button>
      <Button
        variant="secondary"
        onPress={() => {
          setNotice(undefined)
          setFilesOpen(true)
          void refreshModels()
        }}
      >
        Files
      </Button>
      <Show when={wide()}>
        <Text variant="caption" style={{ color: QUIET }}>
          drag to orbit · wheel or pinch to zoom
        </Text>
      </Show>
    </View>
  )

  let Shape = () => (
    <Show when={selected()} fallback={<Text muted>Select a part to edit it — in the list, or tap it in the view.</Text>}>
      {part => <TransformPanel part={part()} store={store} palette={palette} />}
    </Show>
  )

  let viewport = (
    <Viewport
      mesh={mesh()}
      frame={frame()}
      part={selected()}
      tool={tool()}
      ghostFor={part => side.ghost(part)}
      onPick={point => {
        let part = nearestPart(store.parts(), point.x, point.y, point.z)
        if (part !== undefined) store.select(part.id)
      }}
      onMove={(id, origin) => store.change(id, { origin })}
    />
  )

  return (
    <View layout={{ flex: 1 }}>
      <Show when={!wide()}>
        <View layout={{ paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8 }}>
          <Header />
        </View>
      </Show>

      <View layout={{ flexGrow: 1, minHeight: 0 }}>
        {viewport}
        <Show when={wide()}>
          <View layout={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 300, padding: 12, gap: 10 }} style={{ backgroundColor: PANEL }}>
            <Header />
            <Tools />
            <ResolutionRow />
            <ScrollView layout={{ flexGrow: 1, minHeight: 0 }}>
              <PartsPanel store={store} />
            </ScrollView>
            <Footer />
          </View>
          <Show when={selected()}>
            <View layout={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 300, padding: 12 }} style={{ backgroundColor: PANEL }}>
              <ScrollView layout={{ flexGrow: 1, minHeight: 0 }}>
                <Shape />
              </ScrollView>
            </View>
          </Show>
        </Show>
      </View>

      <Show when={!wide()}>
        <View layout={{ height: pct(42), padding: 8 }} style={{ backgroundColor: PANEL }}>
          <ScrollView layout={{ flexGrow: 1, minHeight: 0 }}>
            <Show when={sheet() === "parts"} fallback={<Shape />}>
              <PartsPanel store={store} />
            </Show>
          </ScrollView>
        </View>
        <View layout={{ padding: 8, gap: 8 }}>
          <SegmentedControl
            options={[
              { value: "parts" as const, label: `Parts (${store.parts().length})` },
              { value: "shape" as const, label: "Shape" },
            ]}
            value={sheet()}
            onChange={setSheet}
          />
          <Tools />
          <ResolutionRow />
          <Footer />
        </View>
      </Show>

      <Show when={filesOpen()}>
        <Modal onClose={() => setFilesOpen(false)}>
          <Card layout={{ width: Math.min(760, windowSize().width - 24), height: Math.min(680, windowSize().height - 24) }}>
            <FilesPanel
              name={home()}
              parts={store.parts().length}
              models={models()}
              draftAt={draftAt()}
              readout={mesh() === undefined ? "nothing to print" : describeReport(mesh()!.report)}
              height={heightMm()}
              filaments={filaments()}
              notice={notice()}
              exported={exported()}
              busy={busy()}
              onNew={() => void startOver()}
              onSave={name => void save(name)}
              onOpen={name => void open(name)}
              onDelete={name => void remove(name)}
              onExport={() => void exportPrint()}
              onHeight={mm => setHeightMm(Math.max(1, mm))}
              onFilaments={count => setFilaments(Math.max(1, Math.round(count)))}
              onClose={() => setFilesOpen(false)}
            />
          </Card>
        </Modal>
      </Show>
    </View>
  )
}
