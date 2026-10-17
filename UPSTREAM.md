# Upstream

This app is a port of `apps/sdf-modeller` from big-mesh-studios, a web
monorepo. The port is a rewrite for SolidRT, so upstream patches never apply:
an upstream change is read and re-implemented. This file records which
upstream commit the port matches, what became of every upstream commit after
it, and where each upstream file landed here.

`scripts/upstream.sh` reads the block below.

```
repo:      https://github.com/big-mesh-studios/big-mesh-studios
branch:    main
synced-to: d24e4a58b091cd7f26ba3437475600909e00b8ae
paths:     apps/sdf-modeller packages/csg packages/meshing packages/sdf packages/picking packages/maths packages/ui packages/utils docs/adr
```

- `synced-to` is the newest upstream commit such that it and every tracked
  commit before it is resolved (ported, covered or skipped in the ledger).
  It moves forward only when nothing before the new commit is pending, so
  porting features out of order never makes the pin claim more than is true.
- `paths` are the upstream folders the port draws from. Upstream's other
  apps (spacescape, voxelscape, ...) are not tracked, but their commits show
  up when they touch a shared package.
- The original port (2026-10-09) was made from a shallow clone that recorded
  no commit. `31cc244` was recovered from the time of that clone
  (2026-10-09 13:54 UTC): the last upstream commit before it. No tracked
  path changed between `d5f285c` and `31cc244`, so the base is exact for
  the port's purposes.

## Checking for changes

```sh
scripts/upstream.sh                  # commits since synced-to (NEW = not in the ledger), and a diffstat
scripts/upstream.sh show <commit>    # one commit, limited to the tracked paths
scripts/upstream.sh diff [path...]   # the full diff since synced-to
scripts/upstream.sh base <path>      # an upstream file as the port knows it
```

The script keeps a blobless clone in `.upstream/` (gitignored); `-n` as the
first argument skips the fetch.

## Working through a change

1. Run the script and read each NEW commit (`show`).
2. Add a ledger row for it: `pending` with a note on what it means for the
   port, or `covered` / `skipped` with the reason.
3. To port one, re-implement it, then set its row to `ported` and move
   `synced-to` forward if the rule above allows, staged together with the
   code.
4. Port what upstream does, not an improvement on it. Where the port has
   to differ, add a row to Deviations, staged with the code: if SolidRT
   forced it, also write the gap up in SOLIDRT-FEEDBACK.md and say in the row
   what to revert when it closes. An improvement upstream lacks goes
   under Ideas beyond upstream instead of into the code.
5. Stage porting work (`git add` of the files you changed, by name); do
   not commit. The maintainer reviews what is staged and commits it. A
   commit message names the upstream commits it covers:
   - `Port upstream 5013c68: rotate tool` (several: `Port upstream 81eb709, b2a5e33: ...`)
   - `Upstream: triage to 825d887` for a commit that only updates the ledger.
6. Add an entry to History, staged with the work: what was ported,
   covered or skipped (hashes only, the ledger has the details), where the
   pin moved, which Deviations rows came or went, and any port-only
   change that bears on fidelity (a SolidRT upgrade, a fix to an earlier
   port).

## File map

Where upstream's files (at `synced-to`) live in the port. Upstream's tests
became tests/*.test.ts(x).

| Upstream | Port |
| --- | --- |
| apps/sdf-modeller/src/app.tsx | src/routes/modeller.tsx (layout, tools, wiring), src/app.tsx, src/state.ts |
| apps/sdf-modeller/src/model/model-store.ts | src/model/model-store.ts |
| apps/sdf-modeller/src/model/part.ts | src/model/part.ts |
| apps/sdf-modeller/src/model/mesh-model.ts, packages/meshing/src/model-mesh.ts | src/mesh/mesh-model.ts, src/mesher.ts (the isolate) |
| apps/sdf-modeller/src/file/project.ts, project-file.ts, packages/csg/src/model-file.ts | src/file/project.ts, src/file/zip.ts (jszip's job) |
| apps/sdf-modeller/src/file/save-file.ts | src/file/save-file.ts (`flux:dialog`) |
| apps/sdf-modeller/src/file/home.ts | src/file/home.ts (a path where upstream holds a handle) |
| apps/sdf-modeller/src/file/recent-files.ts | src/file/recent-files.ts (paths in recent.json in app storage, where upstream keeps handles in IndexedDB; a path needs no permission) |
| apps/sdf-modeller/src/file/{autosave,database}.ts | src/file/library.ts (the draft in app storage; the debounce in src/routes/modeller.tsx) |
| apps/sdf-modeller/src/print/* (three-mf, export-model, print-problem, print-budget, print-mesh, quantise, stand) | src/print/print.ts (no thumbnail) |
| apps/sdf-modeller/src/print/print-worker.ts, print.worker.ts, print-mesh-client.ts | src/mesher.ts (`exportThreeMf`, an isolate stream) |
| apps/sdf-modeller/src/ui/parts-panel.tsx | src/ui/parts-panel.tsx |
| apps/sdf-modeller/src/ui/transform-panel.tsx | src/ui/transform-panel.tsx, src/ui/bits.tsx (the number field) |
| apps/sdf-modeller/src/ui/files-panel.tsx, dialog.tsx | src/ui/files-panel.tsx |
| apps/sdf-modeller/src/ui/colour-picker.tsx, popover.tsx | src/ui/colour-picker.tsx, src/model/colour.ts |
| apps/sdf-modeller/src/ui/palette.tsx | src/ui/palette-row.tsx, src/model/palette.ts |
| apps/sdf-modeller/src/ui/icons.tsx | (no counterpart: the port has no icons) |
| apps/sdf-modeller/src/view/viewport.ts, model-view.ts, model-material.ts, ghost.ts, move-handles.ts | src/view/viewport.tsx |
| apps/sdf-modeller/src/view/move-handle.ts | src/view/move-handle.ts |
| apps/sdf-modeller/src/view/rotate-handle.ts, rotate-handles.ts | src/view/rotate-handle.ts, src/view/viewport.tsx (the rings) |
| apps/sdf-modeller/src/view/selection-box.ts, pick-part.ts | src/view/viewport.tsx (the box; picking is native), src/model/part.ts (`pointInPartFrame`, `distanceToPart`) |
| apps/sdf-modeller/src/unwrapping/paint-journal.ts, paint-field.ts, paint-rasterise.ts, paint-brush.ts, paint-file.ts | src/paint/journal.ts, field.ts, rasterise.ts, brush.ts, file.ts |
| apps/sdf-modeller/src/view/field-hit.ts, packages/picking (`pickAlong`, the trace it calls) | src/view/field-hit.ts |
| apps/sdf-modeller/src/view/model-material.ts (the field path) | src/view/paint-material.ts (a `phong` lit program with a `surface` function) |
| apps/sdf-modeller/src/view/paint-cursor.ts | src/view/viewport.tsx (the brush ring) |
| apps/sdf-modeller/src/ui/brush-panel.tsx | src/ui/brush-panel.tsx (the colour picker inline, as the transform panel's is, not in a popover) |
| apps/sdf-modeller/src/app.tsx (paint: journal, field, stroke, undo, load) | src/routes/modeller.tsx; the right column holds the shape panel above the brush panel in one scroll |
| apps/sdf-modeller/src/*.module.css | src/theme.ts and inline layout |
| packages/csg/src/{operations,field,base-field}.ts | src/model/field.ts (no BVH: a linear scan with box reach) |
| packages/csg/src/serialise.ts | src/file/serialise.ts |
| packages/sdf/src/primitives.ts | src/model/primitives.ts |
| packages/meshing/src/marching-cubes.ts | src/mesh/marching-cubes.ts, src/mesh/grid.ts (sampling and block cull, shared) |
| packages/meshing/src/surface-nets.ts | src/mesh/surface-nets.ts, src/mesh/grid.ts |
| packages/meshing/src/split-colour-boundaries.ts | src/mesh/colour-seams.ts |
| packages/meshing/src/vertex-normals.ts | src/mesh/normals.ts |
| packages/meshing/src/mesh-report.ts | src/mesh/report.ts |
| packages/meshing/src/growable.ts | src/mesh/builder.ts |
| packages/picking | (native scene picking, `onTap` on the meshed model) |

## Deviations

Where the port behaves or is built differently from upstream on purpose.
Each row says why, under one of two reasons:

- **SolidRT**: the platform forced it. The row links its SOLIDRT-FEEDBACK.md entry
  and says what to revert once a SolidRT release closes the gap. Check
  these rows on every SolidRT upgrade.
- **Port**: a choice the port made with the platform able to do what
  upstream does. The row says why, so it can be undone if the reason stops
  holding.

Differences that only translate upstream into SolidRT's terms (CSS into
the theme, DOM events into scene events) are not deviations; the file map
covers them.

| What | Reason | Why, and how to revert |
| --- | --- | --- |
| Where the platform shows no file dialog (`flux:dialog` rejects with NotSupportedError: iOS, a Linux session without the portal or zenity, an Android without a document picker), Save and the print's Save write into the app's storage (`models/`, `exports/`, under a free name) and say where, and Open says to use the list | SolidRT | Upstream downloads there, and still opens through a plain file input; without a dialog nothing outside the app's storage can be reached, so the saved models are found again through the remembered list. SOLIDRT-FEEDBACK.md, "No system file picker or save dialog" (resolved in 0.0.78 except on these platforms). Revert: drop the fallback (library.ts's `write*InStorage`, the `UNSUPPORTED` branches in modeller.tsx) once every target platform has a dialog. |
| Number fields ask for a plain keyboard (no `type: "number"` hint) | SolidRT | The hint does not say whether its keypad has a minus key (SOLIDRT-FEEDBACK.md, "The `number` text-input hint..."). Upstream uses plain text too, for the same reason on the web, so behaviour matches. Revert: none needed unless upstream goes back to a numeric keypad. |
| The orbit camera's pointer feed is forwarded by hand from the scene's root listener | SolidRT | No hook to decline a press on `<Scene pointer>` (SOLIDRT-FEEDBACK.md, "Gating a camera's pointer feed per press is undocumented"). Behaviour matches upstream. Revert: hand the feed to `<Scene pointer>` with a filter once one exists. |
| No thumbnail in an exported 3MF | Port | Not ported yet. SolidRT can do it (`readTexture` of the scene's texture, `encodeImage` to PNG). |
| The field is a linear scan of the parts with a box test per part, not upstream's BVH | Port | Simpler, and fast enough at the part counts a person builds by hand. A consequence: the block cull needs no softness margin (see 1b1d66a in the ledger). Revert: port upstream's BVH if large models get slow. |
| Tap picking uses the meshed surface (native scene picking), then names the part by nearest distance, not upstream's ray march | Port | The scene already picks on the drawn triangles. See 6eaee46 in the ledger. |
| The selection box follows a move or rotate drag | Port | Upstream's stays where the part started until release; following the ghost shows where the part will land. Revert: draw the box at `props.part` instead of `pose()` in viewport.tsx. |
| A rotate ring's facing (which way a drag round it turns) is measured from the eye to the part's origin | Port | Upstream compares the ring's axis with the camera's view direction. Under perspective the eye-to-part direction is the one the ring is actually seen along; the two differ only for a ring seen nearly edge-on away from the screen's centre. Revert: test the axis against `target - position` of the camera in `ringsOnScreen` (viewport.tsx). |
| Meshing for a print reports progress through generators: the sampler and marching cubes yield once per layer of blocks, and the export is an async-generator isolate export streaming `{ progress }` then `{ bytes }` | SolidRT | Upstream's mesher calls a progress callback per grid plane and its web worker posts it out; an isolate has no channel out of synchronous work (SOLIDRT-FEEDBACK.md, "An isolate cannot report progress from synchronous work"). Revert: plain loops with a progress callback, posted through the channel once there is one; drop `finish()`, `*Steps` and the stream in mesher.ts. |
| Clear paint works: it enables while there is paint, and undoing it puts the strokes back | Port | Upstream's button reads the journal untracked (`hasPaint={paintJournal.count > 0}`), so it is disabled at mount and never enables; and its undo entry has `apply` and `invert` swapped, so an undo clears the already-empty journal and the paint stays gone. The port enables it on the dab count and records the clear in the store's convention (invert puts the strokes back, one undo step each). Revert: none wanted; offer the fix upstream. |
| The export test waits on meshes in an isolate of its own (`restUntil` in tests/app.test.tsx) | SolidRT | settle() does not wait for an isolate stream (SOLIDRT-FEEDBACK.md, "`settle()` does not wait for an isolate stream"). Test-only. Revert: `rest(app)` once settle() counts an open stream as in flight. |

## Ideas beyond upstream

Improvements found while porting that upstream does not have either. They
are not in the port, so that it stays a faithful copy; each could be
offered upstream, or taken here if a measurement shows it is needed.

- **Marching cubes vertex maps sized to one layer of blocks.** Marching
  cubes remembers the vertex made on each edge (three `Int32Array`s, one
  per axis) and on each exactly-zero corner, so neighbouring cells share
  it. Upstream and the port size these maps to the whole grid: at a
  print's 258 points a side that is about 270 MB, most of the ~340 MB a
  fine export allocates. Both visit cells one layer of blocks at a time
  from the bottom up (the block cull's order), and a layer's cells only
  reach the `BLOCK + 1` planes of points from its floor up. So the maps
  can hold that slab alone, five planes, with the top plane copied down
  as the next layer's floor when the walk moves up one layer (and
  everything cleared when it skips one): about 5 MB at 258, with the
  same vertices out. Each map is then indexed by the edge's lower corner
  within the slab (`(z - floor) * n * n + y * n + x`), which also lets
  every axis share one stride table. A version of this was written and
  passed the mesh tests (session of 2026-10-14) before being taken out
  as an unasked-for deviation. Surface nets' per-cell vertex map
  (`n³` Int32) would shrink the same way.

  Measured since (b1690ae): a 1/64 print of the default capsule peaks at
  346 MB in flux on a desktop and works, so this is not needed there; a
  phone is the place it could matter.
- **The block cull's fill pass, in the port only.** src/mesh/grid.ts
  writes every point of every culled block with its block's centre value,
  so the meshers can read any point. On a 243³ print that pass is about
  4 of the 9.5 seconds. The meshers only read the points of active blocks
  and the one plane of each culled neighbour that touches them, so filling
  just those planes (or reading the centre value straight from `centres`
  for a culled point) would remove most of it. This is the port's own
  code (upstream's broad pass differs), so it needs no Deviations row,
  only a measurement and a test that the meshes come out identical.

- **Paint follows its part, and keeps it through a reorder.** Re-rasterising
  the journal when a rebuild lands (the field is a pure function of the
  journal and the parts) would make paint move with a moved part, which
  upstream's plan intends ("Moving a part re-rasterises") but does not do.
  A dab names its part by index; remapping the journal's indices on a
  reorder or delete (and back on undo) would keep paint on its part
  without changing paint.bin.
- **Per-brick uploads.** SolidRT's `uploadTexture(id, data, box)` writes
  one brick of a 3D texture, so a stroke could send only the slots
  `PaintField.takeDirty()` names (and their indirection cells) instead of
  the whole 7 MB pool on every move; upstream's plan wanted this (M1) and
  its renderer could not.
- **Seamless bricks.** A brick's gutter holds a copy of its own edge
  voxels, so trilinear filtering cannot blend across a brick edge and a
  soft stroke shows a step every 8 voxels. Writing the neighbour's edge
  voxels into the gutter (at the cost upstream's plan weighed) would
  remove it. The material's slot address adds 1.5 where 1.0 would put a
  voxel's value at its own centre: half a voxel of offset.

## Ledger

Every tracked upstream commit after the original base, in upstream order.
Status: `pending` (to port), `ported`, `covered` (the port already does
this its own way), `skipped` (not wanted, or web-only).

Triaged 2026-10-17 against upstream `ba86d41` (its last commit touches no tracked path).

| Commit | Upstream | Status | For the port |
| --- | --- | --- | --- |
| b1690ae | higher resolution print export (ADR 0049) | ported | A typed resolution in the Print card (refused at Export outside 1/64..1/16; −/+ walk upstream's three listed sizes), the 256-sample cap, the samples/triangles/seconds estimate, a progress bar. Seconds constant re-measured under flux: 8e-7 a grid point (upstream 6.5e-7). Peak 346 MB at the cap, as upstream; no change needed. Progress needed a SolidRT workaround, see Deviations. |
| b19a334 | prettier | skipped | Formatting. |
| b2a5e33 | duplicate button | ported | `duplicate(id)` in the store, a Duplicate button over the parts list, the Move tool after. |
| d3da272 | collapse the panel on phones | ported | A chevron beside the compact tabs folds the panel; a tab press reopens it. |
| 5013c68 | rotate tool | ported | src/view/rotate-handle.ts (pure, tested) and the rings in viewport.tsx: three `torus` rings in world axes, grabbed on their drawn outline in screen space, the drag turning the ghost (now meshed unturned and turned as a node) by `multiply(turn, orientation)`, one store write on release. Disabled for round shapes (`isAxial`); `r` selects it. |
| ed51282 | tap a part to select it, selection box | ported | Tap-to-select was already native (`onTap` + `nearestPart`); a tap that hits no model now deselects (the tap looks past the box with `scene.pick`), and the selected part wears upstream's translucent amber box, turned with it and following a move drag. |
| 6cb86ad | prettier | skipped | Formatting. |
| 6eaee46 | ray-march picking | covered | The port picks on the meshed surface natively, then names the part by nearest distance. |
| d1a96b0 | prettier | skipped | Formatting. |
| 81eb709 | reorder parts | ported | ▲/▼ per row, dimmed at the ends; `moveUp`/`moveDown` in the store, one undo step each. |
| 17d7036 | +/− on number fields | ported | −/+ beside every NumberField that has a `step`: 0.05 position, the primitive's own step for dimensions, 0.01 softness, 1 degree, 1 for print height and filaments. Each press is one undo step. The field asks for a plain keyboard, as upstream does (the runtime does not say whether its `number` hint has a minus key). |
| c383473 | parts tab scroll fix | skipped | CSS; the port's ScrollView nesting has no such bug. |
| f77d6f4 | brush painting | ported | As its final design (c002e1a, a4f124b): the Paint tool, the brush panel, the ring, strokes as undo steps. Its UV-atlas half is dead upstream and not ported. |
| 111a929 | paint saved in the draft | ported | A stroke and a clear arm the draft. |
| 20dfc5b | UI layout fix | ported | The brush panel under the shape panel in the right column; a Paint tab in the compact layout. |
| 49bad35 | marching cubes speed | ported | The 8 constant corner strides in marching-cubes.ts. The BVH and allocation changes do not apply (no BVH here). Output identical. |
| 1b1d66a | marching cubes broad pass | covered | src/mesh/grid.ts has its own block cull. Upstream widens its reach by the widest softness; the port needs no margin: a smooth min/max moves along a convex mix of its inputs' gradients, so the folded field stays 1-Lipschitz at any softness (the earlier note here called this a bug; a random search found no culled crossing). tests/mesh.test.ts guards it. |
| c6ca533 | camera controls fix | covered | OrbitCamera already zooms by wheel and pinch and reaches under the model. |
| fa2fe19 | Chrome on Windows rendering fix | skipped | Web-only. Its paint tint/replace formula is in the port (src/view/paint-material.ts). |
| c002e1a | resolution-independent painting | ported | The journal, the sparse brick field, the rasteriser, the brush, the sphere-traced brush hit, the two `sampler3D`s in the material. See "Painting, as ported" below. |
| eafdd77 | prettier | skipped | Formatting. |
| a4f124b | paint appearance, paint survives a save | ported | Stroke-wise compositing, the widened falloff, the 1.5-voxel shell, the unpremultiply in the material, `paint.bin` and the manifest's `paint` field, the journal adopted and rasterised on open. |
| f610c04 | surface nets broad pass (spacescape) | covered | The port's grid.ts cull serves both meshers; lanes and warps are spacescape-only. |
| 7265fb3 | eye dropper | skipped | The browser's EyeDropper API has no SolidRT equivalent. Could become an in-app "take a part's colour" tool. |
| 4879bc6 | rmsl 1.16.0 | skipped | The port does not use rmsl. |
| cde5493 | flat planet (spacescape, ADR 0050) | skipped | Spacescape-only. |
| 25eb290 | Windows-only fix | skipped | A WebGL alpha issue; the port packs opacity into that byte on purpose. |
| 825d887 | prettier | skipped | Formatting. |
| fa5c16e | spacescape move and rotate handles | skipped | Spacescape-only; it touches docs/adr (ADR 0001's table, ADR 0051) to say the level editor took this app's handles. |
| 1f3cd3f | `Polygon` primitive, format version 5 (spacescape floors, ADR 0052, 0053) | ported | In src/model/primitives.ts: `sdPolygon2D`/`sdPolygonPrism` (taking x, y, z like the port's other distance functions), `polygonHalfExtents`, `PrimitiveParameter` as a union with the `variable` arity and `isEditableParameter`, `PALETTE_NAMES` (the parts panel's list), the unit-square `defaultShape`, `radius()` clamping non-finite sizes, `dimensionGroups` leaving the outline out and `withParameter` refusing it. src/file/serialise.ts writes and reads version 5 (the point count first, clamped). `FAR_DISTANCE` moved from field.ts to primitives.ts, where the degenerate outline returns it. The modeller offers no polygon, but opens and draws a file holding one. |
| d24e4a5 | backwards compatibility: versions 3 and 4 read, lowest version written | ported | `READABLE_VERSIONS` {4, 3}, version 3's absent material byte, a polygon refused in an older file, a model without a polygon written at version 4. |

### Painting, as ported

- The design (c002e1a, a4f124b): paint is a journal of 40-byte dabs in
  part-local space (src/paint/journal.ts), rasterised into a sparse field
  of 0.05-unit voxels in 8³ bricks (src/paint/field.ts, rasterise.ts),
  sampled by world position in the model's material. The brush traces the
  model's SDF, not its mesh. Upstream's
  apps/sdf-modeller/docs/resolution-independent-paint-plan.md is the
  design record.
- SolidRT: 0.0.76 has 3D textures (`createTexture3D`, `uploadTexture` with
  a box), so the pool and the indirection grid are two `sampler3D`s, as
  upstream's are; the 2D-atlas workaround planned for 0.0.75 was not needed.
  Like upstream, the whole of both volumes is uploaded whenever paint
  changes (see Ideas for per-brick uploads).
- File format: the manifest's optional `paint: { dabs, strokes }` and a
  `paint.bin` entry (v1); PROJECT_VERSION and model.bin are unchanged. An
  unpainted model writes the same two entries as before. Upstream's atlas
  files (`texture`, `texture.png`, `texture.bin`), written only between
  f77d6f4 and c002e1a, open without their picture.
- Not ported, dead or superseded upstream: the xatlas unwrap, bake and
  atlas files (unwrap*.ts, bake.ts, paint-surface.ts, reference-file.ts,
  mesh/uv-transfer.ts, mesh/triangle-bvh.ts), view/brush-hit.ts,
  unwrapping/stroke-recorder.ts, unwrapping/paint-cull.ts (tested upstream
  but never called).
- Upstream behaviour the port keeps, as it is:
  - Paint does not follow a moved part until the next replay (an undo or
    redo of paint, or opening the file), and a dab names its part by list
    index, so a reorder or a delete re-assigns it. See Ideas.
  - The field is sized to the model at the first stroke (its bounds plus
    4 units, a cube); a part moved past it loses its paint there.
  - Tint and Replace: the radios are disabled (upstream enables them only
    over a baked atlas, which nothing makes now), and the shader's
    `mix(replacing, tinting, blend)` at the blend of 0 they show as Tint
    replaces the part's colour. The blend is not saved.
  - Visible seams every 8 voxels in a soft stroke: a brick's gutter
    copies its own edge voxels, not its neighbour's, so filtering stops
    at each brick edge. See Ideas.

## History

How close the port has been to upstream over time, newest first. One
entry per batch of porting work; the ledger holds what each upstream
commit means, so an entry names commits by hash only.

### 2026-10-17: the polygon and file format version 5

- Pin `fa5c16e` → `d24e4a5`. Nothing pending.
- Ported: 1f3cd3f, d24e4a5 (the `Polygon` primitive; model.bin version
  5, versions 4 and 3 read, version 4 written for a model without a
  polygon, so a saved project still opens in an older build).
- Deviations: none added or removed.

### 2026-10-17: system file dialogs

- Pin unchanged (`fa5c16e`); nothing ported from upstream's ledger.
- Open and Save go through the platform's dialogs (`flux:dialog`), as
  upstream's go through the File System Access API: the document has a
  home (a path), Save writes back to it and asks only for a document that
  has none, Open takes any file (no type filter, as upstream), and the
  Files dialog lists the twelve files opened or written last, each
  forgotten without touching the file. The print's export is upstream's
  two presses again: the first meshes and holds the file, the second
  (naming it and its size) asks where it goes; changing a print setting
  or closing the dialog drops the held file.
- Deviations: "projects live in `models/`" replaced by the no-dialog
  fallback row (SolidRT), which applies only where the platform shows no
  dialog.
- Port-only: the models the port kept in `models/` before this are
  listed as remembered files on the first start, so none is lost from
  sight. The name field and Delete button of the old library are gone
  (upstream has neither).

### 2026-10-17: SolidRT 0.0.78, triage to d24e4a5

- Pin stays at `fa5c16e`. Pending: 1f3cd3f, d24e4a5 (the polygon and
  the file format's backwards compatibility).
- SolidRT 0.0.76 → 0.0.78, no code change. It adds system file dialogs
  (`flux:dialog`), which closes the gap behind the "projects live in
  `models/`" deviation; the other SolidRT rows are unchanged.

### 2026-10-14: painting, SolidRT 0.0.76

- Pin `c383473` → `fa5c16e`. Nothing pending.
- Ported: f77d6f4, 111a929, 20dfc5b, c002e1a, a4f124b (painting, as
  their final design). Skipped: fa5c16e.
- SolidRT 0.0.75 → 0.0.76, which added 3D textures: the paint field is
  two `sampler3D`s as upstream's is, with no workaround.
- Deviations added: Clear paint enables and its undo restores the paint
  (port; upstream's does neither).
- Ideas added: paint following its part through moves and reorders,
  per-brick uploads, seamless bricks. The two upstream paint bugs the
  earlier note said to fix while porting were kept as upstream has them
  and moved to Ideas, by the rule that the port does what upstream does.

### 2026-10-14: everything before painting

- Pin `31cc244` → `c383473`. Pending now: painting alone (f77d6f4,
  111a929, 20dfc5b, c002e1a, a4f124b).
- Ported: b2a5e33, d3da272, 5013c68, ed51282, 81eb709, 17d7036, 49bad35,
  b1690ae.
- 1b1d66a stays covered; its ledger note no longer calls the port's block
  cull a bug (it needs no softness margin).
- Deviations section started, with the differences already in the port
  (files in app storage and the camera's hand-fed pointer, both SolidRT;
  no 3MF thumbnail, the field's linear scan and native picking, all the
  port's).
- Deviations added: number fields without the `number` keyboard hint
  (SolidRT), print progress through generators and an isolate stream
  (SolidRT), the export test's wait on an isolate (SolidRT, test-only),
  the selection box following a drag (port), a ring's facing measured
  from the eye (port).
- Ideas beyond upstream started: marching-cubes vertex maps sized to one
  layer of blocks; a cheaper fill pass in the port's block cull.

### 2026-10-14: upstream tracking, SolidRT 0.0.75

- Tracking set up (this file, scripts/upstream.sh). Base recovered as
  `31cc244`. Triaged 28 upstream commits up to `825d887`: 4 covered, 11
  skipped, 13 pending.
- SolidRT 0.0.70 → 0.0.75. Retired a SolidRT workaround: the port's own
  inflate gave way to the runtime's `CompressionStream`/
  `DecompressionStream`, and zips are now deflated, as upstream's are.

### 2026-10-09: the original port

- `apps/sdf-modeller` ported to SolidRT 0.0.70 from upstream at `31cc244`
  (see the note under the pin block above). Not ported: the 3MF thumbnail;
  files live in app storage for want of a system file dialog.
