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
synced-to: 31cc24458328ebddacde6214081c0cb6ed4692c5
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
   `synced-to` forward if the rule above allows, in the same commit as the
   code.
4. Commit messages name the upstream commits they cover:
   - `Port upstream 5013c68: rotate tool` (several: `Port upstream 81eb709, b2a5e33: ...`)
   - `Upstream: triage to 825d887` for a commit that only updates the ledger.

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
| apps/sdf-modeller/src/print/* (three-mf, export-model, print-problem, quantise, stand) | src/print/print.ts (no thumbnail) |
| apps/sdf-modeller/src/ui/parts-panel.tsx | src/ui/parts-panel.tsx |
| apps/sdf-modeller/src/ui/transform-panel.tsx | src/ui/transform-panel.tsx, src/ui/bits.tsx (the number field) |
| apps/sdf-modeller/src/ui/files-panel.tsx, dialog.tsx | src/ui/files-panel.tsx |
| apps/sdf-modeller/src/ui/colour-picker.tsx, popover.tsx | src/ui/colour-picker.tsx, src/model/colour.ts |
| apps/sdf-modeller/src/ui/palette.tsx | src/ui/palette-row.tsx, src/model/palette.ts |
| apps/sdf-modeller/src/ui/icons.tsx | (no counterpart: the port has no icons) |
| apps/sdf-modeller/src/view/viewport.ts, model-view.ts, model-material.ts, ghost.ts, move-handles.ts | src/view/viewport.tsx |
| apps/sdf-modeller/src/view/move-handle.ts | src/view/move-handle.ts |
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

## Ledger

Every tracked upstream commit after the original base, in upstream order.
Status: `pending` (to port), `ported`, `covered` (the port already does
this its own way), `skipped` (not wanted, or web-only).

Triaged 2026-10-14 against upstream `825d887`.

| Commit | Upstream | Status | For the port |
| --- | --- | --- | --- |
| b1690ae | higher resolution print export (ADR 0049) | pending | Print voxel size chosen by the user, default 0.0625 (port: fixed 0.125), its own sample cap of 256 (port: the viewport's 96), a samples/triangles/seconds estimate. Re-measure the time constant under flux. Export already runs in an isolate; progress would need an async generator. A 258³ grid costs ~340 MB of mesher arrays: size them to the active blocks. Fix the block-cull softness margin (see 1b1d66a) first. |
| b19a334 | prettier | skipped | Formatting. |
| b2a5e33 | duplicate button | pending | `duplicate(id)` in model-store, a button in parts-panel, switch to the Move tool after. |
| d3da272 | collapse the panel on phones | pending | A chevron beside the compact tabs folds the panel; tapping a tab reopens it. |
| 5013c68 | rotate tool | pending | Three world-axis rings (`torus`), screen-space grab like the arrows, the drag turns the ghost by quaternion (ghost meshed without its orientation), one store write on release. Disabled for round shapes (`isAxial`). |
| ed51282 | tap a part to select it, selection box | pending | Tap-to-select is covered (native `onTap` + `nearestPart`). Missing: a tap on empty space should deselect, and the translucent amber box around the selected part. |
| 6cb86ad | prettier | skipped | Formatting. |
| 6eaee46 | ray-march picking | covered | The port picks on the meshed surface natively, then names the part by nearest distance. |
| d1a96b0 | prettier | skipped | Formatting. |
| 81eb709 | reorder parts | pending | ▲/▼ per row; parts fold in list order here too. |
| 17d7036 | +/− on number fields | pending | Steps of 0.05 (position), 0.01 (softness), 1 (rotation), each its own undo step. Upstream also left the numeric keypad (no minus key on phones); check `hints: { type: "number" }` on Android. |
| c383473 | parts tab scroll fix | skipped | CSS; the port's ScrollView nesting has no such bug. |
| f77d6f4 | brush painting | pending | Painting, with c002e1a and a4f124b, which replaced this commit's UV-atlas design. Port the final design only. |
| 111a929 | paint saved in the draft | pending | Painting. |
| 20dfc5b | UI layout fix | pending | With painting: the brush panel stacks under the shape panel in one right column. |
| 49bad35 | marching cubes speed | pending | Only the 8 constant corner strides apply (small). The BVH and allocation changes do not: the port has no BVH. Output identical. |
| 1b1d66a | marching cubes broad pass | covered | src/mesh/grid.ts has its own block cull. Found while comparing: it lacks upstream's `+ widest softness` margin, so at fine sample sizes (below ~0.15) it can cull a block a soft blend's surface passes through. A bug in the port, to fix with a test. |
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
