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

export const sampleGrid = (field: Field, origin: readonly [number, number, number], samples: number, sampleSize: number): Grid => {
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
    }
  }
  return { origin, samples, sampleSize, values, blocks, active }
}

/** Calls `visit` for every cell of every active block, once each. */
export const forEachActiveCell = (grid: Grid, visit: (cx: number, cy: number, cz: number) => void): void => {
  let cells = gridPoints(grid.samples) - 1
  forEachActiveBlock(grid, 0, cells - 1, visit)
}

/**
 * Calls `visit` for every index in [low, high] per axis that falls in an
 * active block, where an index belongs to block floor(index / BLOCK): the
 * cells of the active blocks, or the grid points that own them.
 */
export const forEachActiveBlock = (grid: Grid, low: number, high: number, visit: (x: number, y: number, z: number) => void): void => {
  let { blocks, active } = grid
  for (let bz = 0, b = 0; bz < blocks; bz++) {
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
