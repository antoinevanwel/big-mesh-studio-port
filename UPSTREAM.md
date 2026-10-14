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
synced-to: c38347302ba799599a4096b745dfe1908aef5801
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
| apps/sdf-modeller/src/file/{save-file,autosave,database,recent-files,home}.ts | src/file/library.ts (app storage instead of IndexedDB and browser pickers) |
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
| apps/sdf-modeller/src/view/selection-box.ts, pick-part.ts | src/view/viewport.tsx (the box; picking is native) |
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
| Projects live in a `models/` folder in app storage, listed in the Files dialog; exports land in `exports/` | SolidRT | No system open/save dialog (SOLIDRT-FEEDBACK.md, "No system file picker or save dialog"). Revert: open and save through the platform's dialog once there is one, as upstream does with the File System Access API. A print is therefore written in one press; upstream builds the file on the first press and asks where to save it on a second, because a browser's file picker needs a fresh gesture. |
| Number fields ask for a plain keyboard (no `type: "number"` hint) | SolidRT | The hint does not say whether its keypad has a minus key (SOLIDRT-FEEDBACK.md, "The `number` text-input hint..."). Upstream uses plain text too, for the same reason on the web, so behaviour matches. Revert: none needed unless upstream goes back to a numeric keypad. |
| The orbit camera's pointer feed is forwarded by hand from the scene's root listener | SolidRT | No hook to decline a press on `<Scene pointer>` (SOLIDRT-FEEDBACK.md, "Gating a camera's pointer feed per press is undocumented"). Behaviour matches upstream. Revert: hand the feed to `<Scene pointer>` with a filter once one exists. |
| No thumbnail in an exported 3MF | Port | Not ported yet. SolidRT can do it (`readTexture` of the scene's texture, `encodeImage` to PNG). |
| The field is a linear scan of the parts with a box test per part, not upstream's BVH | Port | Simpler, and fast enough at the part counts a person builds by hand. A consequence: the block cull needs no softness margin (see 1b1d66a in the ledger). Revert: port upstream's BVH if large models get slow. |
| Tap picking uses the meshed surface (native scene picking), then names the part by nearest distance, not upstream's ray march | Port | The scene already picks on the drawn triangles. See 6eaee46 in the ledger. |
| The selection box follows a move or rotate drag | Port | Upstream's stays where the part started until release; following the ghost shows where the part will land. Revert: draw the box at `props.part` instead of `pose()` in viewport.tsx. |
| A rotate ring's facing (which way a drag round it turns) is measured from the eye to the part's origin | Port | Upstream compares the ring's axis with the camera's view direction. Under perspective the eye-to-part direction is the one the ring is actually seen along; the two differ only for a ring seen nearly edge-on away from the screen's centre. Revert: test the axis against `target - position` of the camera in `ringsOnScreen` (viewport.tsx). |
| Meshing for a print reports progress through generators: the sampler and marching cubes yield once per layer of blocks, and the export is an async-generator isolate export streaming `{ progress }` then `{ bytes }` | SolidRT | Upstream's mesher calls a progress callback per grid plane and its web worker posts it out; an isolate has no channel out of synchronous work (SOLIDRT-FEEDBACK.md, "An isolate cannot report progress from synchronous work"). Revert: plain loops with a progress callback, posted through the channel once there is one; drop `finish()`, `*Steps` and the stream in mesher.ts. |
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

## Ledger

Every tracked upstream commit after the original base, in upstream order.
Status: `pending` (to port), `ported`, `covered` (the port already does
this its own way), `skipped` (not wanted, or web-only).

Triaged 2026-10-14 against upstream `825d887`.

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
| f77d6f4 | brush painting | pending | Painting, with c002e1a and a4f124b, which replaced this commit's UV-atlas design. Port the final design only. |
| 111a929 | paint saved in the draft | pending | Painting. |
| 20dfc5b | UI layout fix | pending | With painting: the brush panel stacks under the shape panel in one right column. |
| 49bad35 | marching cubes speed | ported | The 8 constant corner strides in marching-cubes.ts. The BVH and allocation changes do not apply (no BVH here). Output identical. |
| 1b1d66a | marching cubes broad pass | covered | src/mesh/grid.ts has its own block cull. Upstream widens its reach by the widest softness; the port needs no margin: a smooth min/max moves along a convex mix of its inputs' gradients, so the folded field stays 1-Lipschitz at any softness (the earlier note here called this a bug; a random search found no culled crossing). tests/mesh.test.ts guards it. |
| c6ca533 | camera controls fix | covered | OrbitCamera already zooms by wheel and pinch and reaches under the model. |
| fa2fe19 | Chrome on Windows rendering fix | skipped | Web-only, except its paint tint/replace formula, which a painting port should take instead of f77d6f4's. |
| c002e1a | resolution-independent painting | pending | Painting: the final design. See below. |
| eafdd77 | prettier | skipped | Formatting. |
| a4f124b | paint appearance, paint survives a save | pending | Painting: the file format below. |
| f610c04 | surface nets broad pass (spacescape) | covered | The port's grid.ts cull serves both meshers; lanes and warps are spacescape-only. |
| 7265fb3 | eye dropper | skipped | The browser's EyeDropper API has no SolidRT equivalent. Could become an in-app "take a part's colour" tool. |
| 4879bc6 | rmsl 1.16.0 | skipped | The port does not use rmsl. |
| cde5493 | flat planet (spacescape, ADR 0050) | skipped | Spacescape-only. |
| 25eb290 | Windows-only fix | skipped | A WebGL alpha issue; the port packs opacity into that byte on purpose. |
| 825d887 | prettier | skipped | Formatting. |

### Painting, for whoever ports it

- Final design (c002e1a, a4f124b): paint is a journal of 40-byte dabs in
  part-local space (paint-journal.ts), rasterised into a sparse 3D brick
  field of 0.05-unit voxels (paint-field.ts, paint-rasterise.ts), sampled
  by world position in the material. No UV unwrap; independent of mesh
  resolution. Start from apps/sdf-modeller/docs/resolution-independent-paint-plan.md.
- Dead or superseded upstream, do not port: the xatlas unwrap, bake and
  atlas files (unwrap*.ts, bake.ts, paint-surface.ts, reference-file.ts,
  mesh/uv-transfer.ts, mesh/triangle-bvh.ts), view/brush-hit.ts,
  unwrapping/stroke-recorder.ts, unwrapping/paint-cull.ts.
- SolidRT gap: flux:gpu has no 3D textures. Plan: the brick pool as slices
  in a 2D atlas (two bilinear taps, blended), the indirection grid as a 2D
  texture, in a `phong` `surface` function; per-brick rect uploads.
- File format: the manifest gains optional `paint: { dabs, strokes }`, the
  zip gains `paint.bin` (v1). PROJECT_VERSION and model.bin are unchanged.
  Until this is ported, the port opens a painted upstream file and silently
  drops the paint, and re-saving it loses the paint for good.
- Upstream bugs to fix while porting: paint does not follow a moved part
  until the next replay, and a dab names its part by list index, so a
  reorder or delete mis-assigns it.

## History

How close the port has been to upstream over time, newest first. One
entry per batch of porting work; the ledger holds what each upstream
commit means, so an entry names commits by hash only.

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
