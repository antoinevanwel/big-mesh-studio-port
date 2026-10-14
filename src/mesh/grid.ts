// The sample grid both meshers read: the field at (samples + 2)^3 points,
// one sample of margin past the region on every side so a surface touching
// the region's edge still closes.
//
// Only the blocks the surface can pass through are sampled in full. The
// grid is cut into blocks of BLOCK cells a side and the field is asked at
// each block's centre first: the field is a distance (it changes by at most
// the distance moved), so a centre further from the surface than the
// block's half-diagonal has every corner of every cell in the block on its
// own side, no cell there is crossed, and the meshers skip the block. Its
// points get the centre's value, which has the right sign and is never
// interpolated. The surface is two-dimensional, so this turns a cubic
// amount of sampling into roughly a square one.
//
// Soft blends need no extra margin here (upstream's broad pass adds the
// widest softness): a smooth min or max moves along a convex mix of its two
// inputs' gradients, so the folded field changes no faster than its parts
// do, whatever the softness, and a centre value never overstates its
// distance from the surface. tests/mesh.test.ts holds the cull to that.

import type { Field } from "../model/field"

/** Samples within this of zero are stored as zero, so every edge through one agrees where it crosses. */
export const SAMPLE_ZERO = 1e-6

/** Cells per block side. */
export const BLOCK = 4

/**
 * How far past the half-diagonal a block centre must be to be skipped.
 * Above 1 because the ellipsoid's distance is an estimate, not exact.
 */
const SAFETY = 1.5

export interface Grid {
  /** The world position of grid point 1 on each axis (point 0 is one step before). */
  readonly origin: readonly [number, number, number]
  /** Samples across the region on each axis; the grid holds samples + 2. */
  readonly samples: number
  readonly sampleSize: number
  readonly values: Float32Array
  /** Blocks per axis. */
  readonly blocks: number
  /** 1 for a block the surface may cross, 0 for one it cannot. */
  readonly active: Uint8Array
}

export const gridPoints = (samples: number): number => samples + 2

/** The first and last grid point a block covers along one axis. */
export const blockPoints = (block: number, points: number): [number, number] => [block * BLOCK, Math.min(block * BLOCK + BLOCK, points - 1)]

/**
 * Runs a stepwise computation to its end and returns what it returns. The
 * meshing passes are generators so that an export in the mesher isolate
 * can report progress between steps (see `sampleGridSteps`); everything
 * else just wants the result.
 */
export const finish = <T>(steps: Generator<number, T>): T => {
  for (;;) {
    let step = steps.next()
    if (step.done === true) return step.value
  }
}

export const sampleGrid = (field: Field, origin: readonly [number, number, number], samples: number, sampleSize: number): Grid =>
  finish(sampleGridSteps(field, origin, samples, sampleSize))

// How the sampling's three walks share its progress: the block centres, the
// exact samples of the active blocks, and the fill of the rest, which
// writes most of the grid and takes most of the time. Measured on a 243³
// print of the default capsule.
const CENTRES_SHARE = 0.15
const EXACT_SHARE = 0.2

/**
 * `sampleGrid`, yielding its progress (0..1) after each layer of blocks.
 *
 * A workaround for SolidRT: upstream's mesher reports progress through a
 * callback per plane, which its web worker posts to the page as it goes. A
 * flux isolate has no channel out of synchronous work (calls and results
 * are copied values; only an async generator's yields stream back), so the
 * passes are resumable instead. SOLIDRT-FEEDBACK.md, "An isolate cannot report
 * progress from synchronous work"; UPSTREAM.md, Deviations.
 */
export function* sampleGridSteps(field: Field, origin: readonly [number, number, number], samples: number, sampleSize: number): Generator<number, Grid> {
  let n = gridPoints(samples)
  let blocks = Math.ceil((n - 1) / BLOCK)
  let values = new Float32Array(n * n * n).fill(NaN)
  let active = new Uint8Array(blocks * blocks * blocks)
  let centres = new Float32Array(blocks * blocks * blocks)
  let world = (axis: number, point: number) => origin[axis]! + (point - 1) * sampleSize

  for (let bz = 0, b = 0; bz < blocks; bz++) {
    let [z0, z1] = blockPoints(bz, n)
    for (let by = 0; by < blocks; by++) {
      let [y0, y1] = blockPoints(by, n)
      for (let bx = 0; bx < blocks; bx++, b++) {
        let [x0, x1] = blockPoints(bx, n)
        let d = field.distance(world(0, (x0 + x1) / 2), world(1, (y0 + y1) / 2), world(2, (z0 + z1) / 2))
        let reach = 0.5 * sampleSize * Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2 + (z1 - z0) ** 2)
        centres[b] = d
        active[b] = Math.abs(d) <= SAFETY * reach ? 1 : 0
      }
    }
    yield (CENTRES_SHARE * (bz + 1)) / blocks
  }

  // Every point of an active block exactly, once (neighbours share points).
  // Then the rest takes its block's centre value.
  for (let pass = 0; pass < 2; pass++) {
    for (let bz = 0, b = 0; bz < blocks; bz++) {
      let [z0, z1] = blockPoints(bz, n)
      for (let by = 0; by < blocks; by++) {
        let [y0, y1] = blockPoints(by, n)
        for (let bx = 0; bx < blocks; bx++, b++) {
          if (active[b] !== (pass === 0 ? 1 : 0)) continue
          let [x0, x1] = blockPoints(bx, n)
          for (let z = z0; z <= z1; z++) {
            let wz = world(2, z)
            for (let y = y0; y <= y1; y++) {
              let wy = world(1, y)
              let row = (z * n + y) * n
              for (let x = x0; x <= x1; x++) {
                let at = row + x
                if (values[at] === values[at]) continue
                if (pass === 1) {
                  values[at] = centres[b]!
                  continue
                }
                let value = field.distance(world(0, x), wy, wz)
                values[at] = value < SAMPLE_ZERO && value > -SAMPLE_ZERO ? 0 : value
              }
            }
          }
        }
      }
      yield pass === 0 ? CENTRES_SHARE + (EXACT_SHARE * (bz + 1)) / blocks : CENTRES_SHARE + EXACT_SHARE + ((1 - CENTRES_SHARE - EXACT_SHARE) * (bz + 1)) / blocks
    }
  }
  return { origin, samples, sampleSize, values, blocks, active }
}

/** Calls `visit` for every cell of every active block (of one z `layer` of blocks, if given), once each. */
export const forEachActiveCell = (grid: Grid, visit: (cx: number, cy: number, cz: number) => void, layer?: number): void => {
  let cells = gridPoints(grid.samples) - 1
  forEachActiveBlock(grid, 0, cells - 1, visit, layer)
}

/**
 * Calls `visit` for every index in [low, high] per axis that falls in an
 * active block, where an index belongs to block floor(index / BLOCK): the
 * cells of the active blocks, or the grid points that own them. With
 * `layer`, only the blocks of that layer along z.
 */
export const forEachActiveBlock = (grid: Grid, low: number, high: number, visit: (x: number, y: number, z: number) => void, layer?: number): void => {
  let { blocks, active } = grid
  let first = layer ?? 0
  let last = layer ?? blocks - 1
  for (let bz = first, b = first * blocks * blocks; bz <= last; bz++) {
    let z1 = Math.min(bz * BLOCK + BLOCK - 1, high)
    for (let by = 0; by < blocks; by++) {
      let y1 = Math.min(by * BLOCK + BLOCK - 1, high)
      for (let bx = 0; bx < blocks; bx++, b++) {
        if (active[b] === 0) continue
        let x1 = Math.min(bx * BLOCK + BLOCK - 1, high)
        for (let z = Math.max(bz * BLOCK, low); z <= z1; z++)
          for (let y = Math.max(by * BLOCK, low); y <= y1; y++)
            for (let x = Math.max(bx * BLOCK, low); x <= x1; x++) visit(x, y, z)
      }
    }
  }
}
