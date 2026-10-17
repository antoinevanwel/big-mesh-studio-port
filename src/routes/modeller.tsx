// The modeller: the 3D view, the parts list and primitive picker, the
// selected part's panel, the tools, the mesher controls, undo, and the
// files dialog. Ported from big-mesh-studios' apps/sdf-modeller app.tsx.
//
// The mesh is the result of the model, never the model: an edit changes
// the parts at once and the mesh follows from the mesher isolate after the
// model has been still for REBUILD_MS, so a drag or a run of typing is one
// rebuild rather than one per change.
//
// Wide windows lay the panels over the view (the parts on the left; on the
// right the selected part above the brush); a compact one stacks the view
// above one panel at a time, chosen by tabs, so they can never overlap; a
// chevron beside the tabs folds that panel away, and tapping a tab opens it
// again.
//
// Paint is a journal of dabs in part-local space (the only durable paint
// state, saved in the project) rasterised into a sparse field of world
// voxels the model's material samples. The field is made by the first
// stroke, sized to the model then, and rebuilt from the journal by undo,
// redo and opening a file.

import { capabilities, createEffect, createMemo, createSignal, Match, onSettled, pct, Show, Switch, textInputActive, windowSize, type KeyEvent } from "@solidrt/core"
import { Button, Card, Modal, ScrollView, SegmentedControl, Slider, Text, View } from "@solidrt/components"
import { file } from "flux:fs"
import { isolate } from "flux:isolate"
import { homeName, NOWHERE, type Home } from "../file/home"
import { clearDraft, readDraft, saveDraft, writeExportInStorage, writeModelInStorage } from "../file/library"
import { PROJECT_EXTENSION, readProject, writeProject, type Project } from "../file/project"
import { forgetFile, listRecentFiles, readThrough, rememberFile, type RecentFile } from "../file/recent-files"
import { chooseFileToRead, choosePlaceToWrite, dialogsMissing, UNSUPPORTED } from "../file/save-file"
import { budgetFor, DEFAULT_MESH_MODE, DEFAULT_RESOLUTION, MESH_MODES, meshRegion, RESOLUTIONS, type MeshMode, type Resolution } from "../mesh/mesh-model"
import { describeReport } from "../mesh/report"
import type * as Mesher from "../mesher"
import type { ViewMesh } from "../mesher"
import { Field, nearestPart } from "../model/field"
import { createModelStore } from "../model/model-store"
import { createPalette, STARTER_PALETTE } from "../model/palette"
import { conjugate, modelBounds, newModel, pointInPartFrame, rotate, type Part } from "../model/part"
import { isAxial } from "../model/primitives"
import type { Vec3 } from "../model/types"
import { PaintBrush, type Localiser } from "../paint/brush"
import { BRICK, GRID_RES, PaintField } from "../paint/field"
import { PaintJournal, type RemovedDabs } from "../paint/journal"
import { rasterise, type Placed } from "../paint/rasterise"
import { DEFAULT_HEIGHT_MM, DEFAULT_MAX_COLOURS, DEFAULT_PRINT_VOXEL_SIZE, describePrintEstimate, MIN_PRINT_VOXEL_SIZE, printEstimate, printVoxelSizeOk } from "../print/print"
import { registerShortcuts } from "../state"
import { PANEL, QUIET } from "../theme"
import { BrushPanel, defaultBrush, type BrushState } from "../ui/brush-panel"
import { FilesPanel } from "../ui/files-panel"
import { PartsPanel } from "../ui/parts-panel"
import { TransformPanel } from "../ui/transform-panel"
import type { BrushSurface, FieldHit } from "../view/field-hit"
import { Viewport, type Tool } from "../view/viewport"

/** How long the model has to be still before it is re-meshed, in ms. */
const REBUILD_MS = 90
/** How long after a rebuild the draft is written, in ms. */
const AUTOSAVE_MS = 1000

/** The paint field's voxel, in world units: absolute, so a figure twice the size gets twice the voxels. */
const PAINT_VOXEL = 0.05
/** The widest box a field addresses: 64 bricks of 8 voxels. */
const PAINT_REACH = GRID_RES * BRICK * PAINT_VOXEL
/** Bricks a side of the pool: 1728 bricks, 7 MB. Running out drops a stroke's outermost voxels. */
const PAINT_TILES = 12
const PAINT_DETAIL = `${1 / PAINT_VOXEL} paint texels a world unit`
/** How far past the model's bounds the field reaches, for a brush at its silhouette. */
const PAINT_PAD = 4

// Two mesher instances: the model's rebuilds queue on one, so a drag ghost
// or an export never waits behind a fine-resolution rebuild.
const mesher = isolate<typeof Mesher>("mesher")
const side = isolate<typeof Mesher>("mesher")

type Frame = { centre: Vec3; size: number }

const message = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason))

const DEFAULT_PROJECT_NAME = `model${PROJECT_EXTENSION}`
const PROJECT_CHOICE = { description: "SDF model", extension: PROJECT_EXTENSION.slice(1) }
const THREE_MF_CHOICE = { description: "3D print model", extension: "3mf" }

export function Modeller() {
  let store = createModelStore(newModel())
  let palette = createPalette(STARTER_PALETTE)
  let [tool, setTool] = createSignal<Tool>("select")
  let [mode, setMode] = createSignal<MeshMode>(DEFAULT_MESH_MODE)
  let [resolution, setResolution] = createSignal<Resolution>(DEFAULT_RESOLUTION)
  let [sheet, setSheet] = createSignal<"parts" | "shape" | "paint">("parts")
  // A compact window can fold the panel down to its tabs, giving the view the
  // height back. Open by default: the tabs are how the parts list is found.
  let [sheetOpen, setSheetOpen] = createSignal(true)
  let [status, setStatus] = createSignal("meshing…")
  let [mesh, setMesh] = createSignal<ViewMesh | undefined>()
  let [frame, setFrame] = createSignal<Frame | undefined>(undefined, {
    equals: (a, b) => a === b || (a !== undefined && b !== undefined && a.size === b.size && a.centre.x === b.centre.x && a.centre.y === b.centre.y && a.centre.z === b.centre.z),
  })

  // Where the document lives (see file/home.ts) and the files dialog.
  let [home, setHome] = createSignal<Home>(NOWHERE)
  let [filesOpen, setFilesOpen] = createSignal(false)
  let [recent, setRecent] = createSignal<readonly RecentFile[]>([])
  let [draftAt, setDraftAt] = createSignal<number | undefined>()
  let [busy, setBusy] = createSignal(false)
  let [notice, setNotice] = createSignal<string | undefined>()
  // Where a file went without a dialog (the app's storage), as the OS spells it.
  let [written, setWritten] = createSignal<string | undefined>()
  let [heightMm, setHeightMm] = createSignal(DEFAULT_HEIGHT_MM)
  let [filaments, setFilaments] = createSignal(DEFAULT_MAX_COLOURS)
  let [printResolution, setPrintResolution] = createSignal(DEFAULT_PRINT_VOXEL_SIZE)
  let [printing, setPrinting] = createSignal<number | undefined>()
  // A built print waiting for the second press that saves it, as upstream's:
  // meshing takes seconds, and the save dialog opens on a press of its own.
  let [printFile, setPrintFile] = createSignal<{ readonly bytes: Uint8Array; readonly name: string } | undefined>()
  let printFileLabel = () => {
    let built = printFile()
    return built === undefined ? undefined : `${built.name} · ${Math.max(1, Math.round(built.bytes.length / 1e6))} MB`
  }
  let estimate = () => {
    let voxelSize = printResolution()
    let found = printVoxelSizeOk(voxelSize) ? printEstimate(store.parts(), voxelSize) : undefined
    return found === undefined ? "" : describePrintEstimate(found)
  }

  // The paint. The journal and the field are plain values (nothing renders
  // from them directly); the signals say what the panel and the view show.
  let journal = new PaintJournal()
  let field: PaintField | undefined
  let painter: PaintBrush | undefined
  let [paintField, setPaintField] = createSignal<PaintField | undefined>()
  let [paintRevision, setPaintRevision] = createSignal(0)
  let [dabCount, setDabCount] = createSignal(0)
  let [brush, setBrush] = createSignal<BrushState>(defaultBrush({ r: 255, g: 255, b: 255, a: 255 }))
  let [blend, setBlend] = createSignal(0)
  // The folded field the brush traces, replaced with each mesh it describes.
  let [surface, setSurface] = createSignal<BrushSurface | undefined>()

  let selected = createMemo((): Part | undefined => {
    let id = store.selected()
    return id === undefined ? undefined : store.parts().find(part => part.id === id)
  })
  let wide = () => capabilities.windowSizeClass !== "compact"
  // Turning a sphere, an ellipsoid or a round box changes nothing.
  let rotatable = () => {
    let part = selected()
    return part !== undefined && isAxial(part.shape.type)
  }

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
    setSurface(result === null ? undefined : { field: new Field(job.parts), step: meshRegion(job.parts, budgetFor(DEFAULT_RESOLUTION))?.sampleSize ?? DEFAULT_RESOLUTION, parts: job.parts })
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

  // -- Paint ------------------------------------------------------------------

  /** A world point and normal into a part's own frame, and a dab back out to the world. */
  let partTransforms = (parts: readonly Part[]): { localise: Localiser; place: (part: number, centre: Vec3, normal: Vec3) => Placed | undefined } => ({
    localise: (part, point, normal) => {
      let own = pointInPartFrame(parts[part]!, point)
      let turned = rotate(normal, conjugate(parts[part]!.orientation))
      return { centre: [own.x, own.y, own.z], normal: [turned.x, turned.y, turned.z] }
    },
    place: (part, centre, normal) => {
      let own = parts[part]
      if (own === undefined) return undefined
      let turned = rotate(centre, own.orientation)
      let n = rotate(normal, own.orientation)
      let length = Math.hypot(n.x, n.y, n.z)
      return {
        centre: { x: turned.x + own.origin.x, y: turned.y + own.origin.y, z: turned.z + own.origin.z },
        normal: length === 0 ? { x: 0, y: 1, z: 0 } : { x: n.x / length, y: n.y / length, z: n.z / length },
      }
    },
  })

  let painted = () => setPaintRevision(revision => revision + 1)

  /**
   * The field for a model, made once and then kept: a cube over its bounds,
   * padded, at an absolute voxel size. A model too wide for the grid gets
   * none and says so, rather than throwing in the middle of a drag.
   */
  let ensureField = (parts: readonly Part[]): PaintField | undefined => {
    if (field !== undefined) return field
    let bounds = modelBounds(parts)
    if (bounds === undefined) return undefined
    let span = (lo: number, hi: number) => hi - lo + PAINT_PAD * 2
    let side = Math.max(span(bounds.min.x, bounds.max.x), span(bounds.min.y, bounds.max.y), span(bounds.min.z, bounds.max.z))
    if (side > PAINT_REACH) {
      setNotice("this model is too large for the paint field at its current resolution; move the parts closer together or use a smaller model")
      return undefined
    }
    field = PaintField.over(PAINT_VOXEL, [bounds.min.x - PAINT_PAD, bounds.min.y - PAINT_PAD, bounds.min.z - PAINT_PAD], [side, side, side], PAINT_TILES)
    setPaintField(field)
    return field
  }

  /** The field cleared and the whole journal replayed: undo, redo and a clear are all this. */
  let rasteriseJournal = () => {
    if (field === undefined) return
    field.clearAll()
    rasterise(journal, field, partTransforms(store.parts()).place)
    field.markChanged()
    painted()
  }

  /** Drops the document's paint, for another document: the field was sized to this one. */
  let resetPaint = () => {
    journal.clear()
    setDabCount(0)
    field = undefined
    setPaintField(undefined)
  }

  let paintStart = (): boolean => {
    let parts = store.parts()
    if (painter !== undefined || surface() === undefined || parts.length === 0) return false
    let made = ensureField(parts)
    if (made === undefined) return false
    // Taken once: a drag's brush cannot change under it.
    let held = brush()
    let { localise, place } = partTransforms(parts)
    painter = new PaintBrush(journal, made, { radius: held.width / 2, hardness: held.hardness, colour: held.colour }, localise, place)
    return true
  }

  let paintMove = (hit: FieldHit) => {
    painter?.moveTo(hit)
    painted()
  }

  // One undo entry per stroke; its inverse is a truncation and a replay.
  let paintEnd = (): boolean => {
    let recorder = painter
    painter = undefined
    if (recorder === undefined) return false
    let result = recorder.finish()
    setDabCount(journal.count)
    if (result.dabs === 0) return false
    let taken: RemovedDabs | undefined
    armDraft()
    store.record({
      label: "Paint",
      apply: () => {
        if (taken !== undefined) journal.redoStroke(taken)
        rasteriseJournal()
        setDabCount(journal.count)
        armDraft()
      },
      invert: () => {
        taken = journal.undoStroke()
        rasteriseJournal()
        setDabCount(journal.count)
        armDraft()
      },
    })
    return true
  }

  let clearPaint = () => {
    if (journal.count === 0 || field === undefined) return
    let taken: RemovedDabs | undefined
    let clear = () => {
      taken = journal.clearWithUndo()
      rasteriseJournal()
      setDabCount(journal.count)
      armDraft()
    }
    clear()
    store.record({
      label: "Clear paint",
      apply: clear,
      invert: () => {
        if (taken !== undefined) journal.redoStroke(taken)
        rasteriseJournal()
        setDabCount(journal.count)
        armDraft()
      },
    })
  }

  let draftTimer: ReturnType<typeof setTimeout> | undefined
  let armDraft = () => {
    if (!restored) return
    if (draftTimer !== undefined) clearTimeout(draftTimer)
    draftTimer = setTimeout(() => {
      let at = Date.now()
      void writeProject(project(), journal).then(bytes => saveDraft(bytes, at)).then(
        () => setDraftAt(at),
        () => {},
      )
    }, AUTOSAVE_MS)
  }

  let loadInto = (opened: Project, label: string): boolean => {
    setMode(opened.view.mode)
    setResolution(opened.view.resolution)
    palette.set(opened.palette)
    let loaded = store.load(opened.parts, label)
    // The paint goes with the document it belongs to; a loaded journal is
    // in the place a drawn one is: the truth, with nothing in a field yet.
    resetPaint()
    if (opened.paint !== undefined) {
      journal.adopt(opened.paint)
      setDabCount(journal.count)
      let made = ensureField(opened.parts)
      if (made !== undefined) {
        rasterise(journal, made, partTransforms(opened.parts).place)
        made.markChanged()
        painted()
      }
    }
    return loaded
  }

  let refreshRecent = async () => setRecent(await listRecentFiles())

  /** Runs a file action, putting its refusal where the dialog shows it. */
  let attempt = async (action: () => Promise<void>) => {
    setNotice(undefined)
    setWritten(undefined)
    setBusy(true)
    try {
      await action()
    } catch (reason) {
      setNotice(message(reason))
    } finally {
      setBusy(false)
    }
  }

  /** Loads a picked or remembered file; it becomes the document's home. */
  let openFrom = async (path: string, name: string) => {
    let bytes = await readThrough(path)
    if (bytes === undefined) throw new Error(`could not read ${name} — it has moved, or is gone`)
    let opened = await readProject(bytes)
    if (!loadInto(opened, `open ${name}`)) throw new Error("this file holds more parts than the limit, or two parts with one id")
    // Before the awaits: the load just queued a rebuild, and its readout
    // must land after this line, not under it (UPSTREAM.md, Deviations).
    setStatus(`opened ${name}`)
    setHome({ kind: "file", path, name })
    // The opened project's own count: store.parts() reads the old list until the flush.
    await rememberFile(path, name, opened.parts.length)
    await refreshRecent()
    closeFiles()
  }

  let openFromDisk = () =>
    attempt(async () => {
      let picked = await chooseFileToRead()
      if (picked === UNSUPPORTED) throw new Error("this device shows no file dialog — open a model from the list below")
      // Backing out of the dialog is not a failure, and says nothing.
      if (picked !== undefined) await openFrom(picked.path, picked.name)
    })

  let openRecent = (entry: RecentFile) => attempt(() => openFrom(entry.path, entry.name))

  /**
   * Writes the document where it came from, or asks where when that is not
   * known: Save and Save as are one button, the difference being the home.
   */
  let saveToDisk = () =>
    attempt(async () => {
      let here = home()
      let bytes = await writeProject(project(), journal)
      let target = here.kind === "file" ? here : await choosePlaceToWrite(PROJECT_CHOICE, DEFAULT_PROJECT_NAME)
      if (target === undefined) return
      if (target === UNSUPPORTED) {
        // Upstream downloads here, and the home stays nowhere; the list is
        // how a file written to this app's storage is found again.
        let stored = await writeModelInStorage(DEFAULT_PROJECT_NAME, bytes)
        await rememberFile(stored.path, stored.name, store.parts().length)
        setWritten(stored.shown)
      } else {
        await file(target.path).write(bytes, { atomic: true })
        setHome({ kind: "file", path: target.path, name: target.name })
        await rememberFile(target.path, target.name, store.parts().length)
      }
      setStatus(`saved ${homeName(home())}`)
      await refreshRecent()
    })

  let forgetRecent = (path: string) => attempt(async () => {
    await forgetFile(path)
    await refreshRecent()
  })

  let startOver = () =>
    attempt(async () => {
      await clearDraft()
      setDraftAt(undefined)
      palette.set([])
      setHome(NOWHERE)
      resetPaint()
      store.load(newModel(), "new model")
      setStatus("new model")
    })

  // The print takes its name from the document's, without the extension.
  let stemOf = () => {
    let name = homeName(home())
    let dot = name.lastIndexOf(".")
    return dot > 0 ? name.slice(0, dot) : name
  }

  // Setting one of the export's numbers throws away a file built with the old ones.
  let forgetPrintFile =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      setPrintFile(undefined)
      set(value)
    }

  /** A file built and not saved goes with the dialog, as upstream's. */
  let closeFiles = () => {
    setPrintFile(undefined)
    setFilesOpen(false)
  }

  let savePrintFile = () =>
    attempt(async () => {
      let built = printFile()
      if (built === undefined) return
      let target = await choosePlaceToWrite(THREE_MF_CHOICE, built.name)
      // A dismissed dialog keeps the file here to try again.
      if (target === undefined) return
      if (target === UNSUPPORTED) setWritten((await writeExportInStorage(built.name, built.bytes)).shown)
      else await file(target.path).write(built.bytes, { atomic: true })
      setPrintFile(undefined)
    })

  let buildPrint = () =>
    attempt(async () => {
      let name = stemOf()
      let voxelSize = printResolution()
      if (!printVoxelSizeOk(voxelSize)) throw new Error(`a print meshes between ${MIN_PRINT_VOXEL_SIZE} and ${DEFAULT_PRINT_VOXEL_SIZE} world units a voxel`)
      let bytes: Uint8Array | undefined
      try {
        setPrinting(0)
        for await (let step of side.exportThreeMf(store.parts() as Part[], { heightMm: heightMm(), maxColours: filaments(), title: name, voxelSize })) {
          if ("bytes" in step) bytes = step.bytes
          else setPrinting(step.progress)
        }
      } finally {
        setPrinting(undefined)
      }
      if (bytes === undefined) throw new Error("the export ended without a file")
      setPrintFile({ bytes, name: `${name}.3mf` })
    })

  // A draft is restored silently, as every editor worth using does; one
  // this build cannot read is thrown away rather than refused on every start.
  onSettled(() => {
    void (async () => {
      try {
        let draft = await readDraft()
        if (draft !== undefined && !disposed) {
          if (loadInto(await readProject(draft.bytes), "restore")) {
            setDraftAt(draft.at || undefined)
            setStatus("restored from this app")
          }
        }
      } catch {
        await clearDraft().catch(() => {})
      }
      restored = true
      await refreshRecent().catch(() => {})
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
        void refreshRecent()
      } else if (textInputActive()) return
      else if (key === "delete" || key === "backspace") {
        let part = selected()
        if (part !== undefined) store.remove(part.id)
      } else if (key === "escape") {
        if (filesOpen()) setFilesOpen(false)
        else setTool("select")
      } else if (key === "v") setTool("select")
      else if ((key === "g" || key === "m") && selected() !== undefined) setTool("move")
      else if (key === "r" && rotatable()) setTool("rotate")
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
      <Button variant={tool() === "rotate" ? "primary" : "secondary"} disabled={!rotatable()} onPress={() => setTool("rotate")}>
        Rotate
      </Button>
      <Button variant={tool() === "paint" ? "primary" : "secondary"} disabled={store.parts().length === 0} onPress={() => setTool("paint")}>
        Paint
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
          void refreshRecent()
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

  let Brush = () => (
    <BrushPanel
      brush={brush()}
      onWidth={width => setBrush({ ...brush(), width })}
      onHardness={hardness => setBrush({ ...brush(), hardness })}
      // Not remembered in the palette: the picker reports every pointer move.
      onColour={colour => setBrush({ ...brush(), colour })}
      palette={palette}
      fieldDetail={paintField() === undefined ? undefined : PAINT_DETAIL}
      dabs={dabCount()}
      hasPaint={dabCount() > 0}
      onClear={clearPaint}
      blend={blend()}
      onBlend={setBlend}
      blendable={false}
    />
  )

  let viewport = (
    <Viewport
      mesh={mesh()}
      frame={frame()}
      part={selected()}
      tool={tool()}
      ghostFor={part => side.ghost(part)}
      onPick={point => store.select(point === undefined ? undefined : nearestPart(store.parts(), point.x, point.y, point.z)?.id)}
      onMove={(id, origin) => store.change(id, { origin })}
      onTurn={(id, orientation) => store.change(id, { orientation })}
      surface={surface()}
      brushRadius={brush().width / 2}
      paintField={paintField()}
      paintRevision={paintRevision()}
      paintBlend={blend()}
      onPaintStart={paintStart}
      onPaint={paintMove}
      onPaintEnd={paintEnd}
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
              <PartsPanel store={store} onDuplicate={() => setTool("move")} />
            </ScrollView>
            <Footer />
          </View>
          <View layout={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 300, padding: 12 }} style={{ backgroundColor: PANEL }}>
            <ScrollView layout={{ flexGrow: 1, minHeight: 0 }}>
              <View layout={{ gap: 16 }}>
                <Show when={selected()}>{part => <TransformPanel part={part()} store={store} palette={palette} />}</Show>
                <Brush />
              </View>
            </ScrollView>
          </View>
        </Show>
      </View>

      <Show when={!wide()}>
        <Show when={sheetOpen()}>
          <View layout={{ height: pct(42), padding: 8 }} style={{ backgroundColor: PANEL }}>
            <ScrollView layout={{ flexGrow: 1, minHeight: 0 }}>
              <Switch>
                <Match when={sheet() === "parts"}>
                  <PartsPanel store={store} onDuplicate={() => setTool("move")} />
                </Match>
                <Match when={sheet() === "shape"}>
                  <Shape />
                </Match>
                <Match when={sheet() === "paint"}>
                  <Brush />
                </Match>
              </Switch>
            </ScrollView>
          </View>
        </Show>
        <View layout={{ padding: 8, gap: 8 }}>
          <View layout={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
            <SegmentedControl
              options={[
                { value: "parts" as const, label: `Parts (${store.parts().length})` },
                { value: "shape" as const, label: "Shape" },
                { value: "paint" as const, label: "Paint" },
              ]}
              value={sheet()}
              onChange={id => {
                setSheet(id)
                setSheetOpen(true)
              }}
              layout={{ flexGrow: 1 }}
            />
            <Button variant="secondary" layout={{ paddingLeft: 12, paddingRight: 12 }} onPress={() => setSheetOpen(open => !open)}>
              {sheetOpen() ? "▾" : "▴"}
            </Button>
          </View>
          <Tools />
          <ResolutionRow />
          <Footer />
        </View>
      </Show>

      <Show when={filesOpen()}>
        <Modal onClose={closeFiles}>
          <Card layout={{ width: Math.min(760, windowSize().width - 24), height: Math.min(680, windowSize().height - 24) }}>
            <FilesPanel
              home={home()}
              parts={store.parts().length}
              recent={recent()}
              showsDialogs={!dialogsMissing()}
              draftAt={draftAt()}
              readout={mesh() === undefined ? "nothing to print" : describeReport(mesh()!.report)}
              height={heightMm()}
              filaments={filaments()}
              resolution={printResolution()}
              estimate={estimate()}
              printing={printing()}
              builtFile={printFileLabel()}
              onResolution={forgetPrintFile(setPrintResolution)}
              notice={notice()}
              written={written()}
              busy={busy()}
              onNew={() => void startOver()}
              onOpen={() => void openFromDisk()}
              onSave={() => void saveToDisk()}
              onOpenRecent={entry => void openRecent(entry)}
              onForgetRecent={path => void forgetRecent(path)}
              onExport={() => void buildPrint()}
              onSavePrint={() => void savePrintFile()}
              onHeight={forgetPrintFile((mm: number) => setHeightMm(Math.max(1, mm)))}
              onFilaments={forgetPrintFile((count: number) => setFilaments(Math.max(1, Math.round(count))))}
              onClose={closeFiles}
            />
          </Card>
        </Modal>
      </Show>
    </View>
  )
}
