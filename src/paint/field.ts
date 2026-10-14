// The paint field: a colour per world-space voxel, stored sparsely in
// bricks. Ported from big-mesh-studios' sdf-modeller
// unwrapping/paint-field.ts.
//
// Bricks are 8³ voxels in a 10³ slot of a pool laid out exactly as the 3D
// texture the material samples (no repack between the two), and only where
// a dab has been, so the cost is the painted area rather than the model's
// box. An indirection grid of 64³ entries says which slot each brick lives
// in. The two extra voxels of a slot are a gutter: hardware trilinear reads
// a voxel's neighbours, and at a brick's edge they belong to another brick,
// so each brick's edge voxels are duplicated into its own border and one
// lookup is enough. An unallocated brick reads as clear.

/** Voxels along one edge of a brick's useful interior. */
export const BRICK = 8
/** A brick and its one-voxel gutter on each side. */
export const SLOT = BRICK + 2
export const SLOT_VOXELS = SLOT * SLOT * SLOT
/** The indirection grid's edge, in bricks: the largest box a field addresses. */
export const GRID_RES = 64
/** Bricks a field holds along one edge by default, so `TILES ** 3` in all. */
export const TILES = 16

export interface Region {
  readonly x0: number
  readonly y0: number
  readonly z0: number
  readonly x1: number
  readonly y1: number
  readonly z1: number
}

/** One texel's worth of paint. */
export interface Texel {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

const clampByte = (value: number): number => (value < 0 ? 0 : value > 255 ? 255 : Math.round(value))

/**
 * The slot cells holding voxel `v` of a brick: cell n holds voxel
 * min(max(n - 1, 0), BRICK - 1), so an edge voxel has a second cell, its
 * copy in the gutter.
 */
const BORDER: readonly (readonly number[])[] = Array.from({ length: BRICK }, (_, voxel) => (voxel === 0 ? [1, 0] : voxel === BRICK - 1 ? [BRICK, SLOT - 1] : [voxel + 1]))

export class PaintField {
  /** Every slot's texels, four bytes apiece, laid out as a `tiles * SLOT` cube. */
  readonly pool: Uint8Array
  /** `[slotX, slotY, slotZ, allocated]` per brick of the grid. */
  readonly indirection: Uint8Array
  private free: number[]
  /** Slots touched since the last `takeDirty`, for a partial upload. */
  private dirty = new Set<number>()
  /** Whether anything was written since the GPU was last told. */
  private sinceSync = true

  readonly tiles: number
  /** World units a voxel. */
  readonly voxelSize: number
  /** Where voxel (0, 0, 0) starts. */
  readonly origin: readonly [number, number, number]
  /** The box, in world units: the unit the shader normalises by. */
  readonly extent: readonly [number, number, number]
  /** The box in voxels per axis, rounded up so it covers the model. */
  readonly voxels: readonly [number, number, number]

  private constructor(tiles: number, voxelSize: number, origin: readonly [number, number, number], extent: readonly [number, number, number], pool: Uint8Array, indirection: Uint8Array, free: number[]) {
    this.tiles = tiles
    this.voxelSize = voxelSize
    this.origin = origin
    this.extent = extent
    this.voxels = [Math.max(1, Math.ceil(extent[0] / voxelSize)), Math.max(1, Math.ceil(extent[1] / voxelSize)), Math.max(1, Math.ceil(extent[2] / voxelSize))]
    this.pool = pool
    this.indirection = indirection
    this.free = free
  }

  /** The pool texture's edge in texels. */
  get poolDim(): number {
    return this.tiles * SLOT
  }

  /** How many bricks this box spans per axis, which is not GRID_RES (the most the grid holds). */
  get bricksPerAxis(): readonly [number, number, number] {
    return [this.extent[0] / (BRICK * this.voxelSize), this.extent[1] / (BRICK * this.voxelSize), this.extent[2] / (BRICK * this.voxelSize)]
  }

  /**
   * An empty field over a world box (`size` in world units). Too small a
   * pool drops writes later; too small a grid throws now, because a brick
   * past its edge would alias onto the ones at the start.
   */
  static over(voxelSize: number, origin: readonly [number, number, number], size: readonly [number, number, number], tiles: number = TILES): PaintField {
    // A slot's coordinates go in one byte each.
    if (tiles < 1 || tiles > 256) throw new RangeError(`a field holds 1 to 256 slots a side, not ${tiles}`)
    let reach = GRID_RES * BRICK
    for (let axis = 0; axis < 3; axis++) {
      let needed = Math.ceil(size[axis]! / voxelSize)
      if (needed > reach) throw new RangeError(`a field's box is ${size[axis]} units on axis ${axis}, which is ${needed} voxels, and its grid holds ${reach}`)
    }
    return new PaintField(
      tiles,
      voxelSize,
      origin,
      size,
      new Uint8Array(tiles ** 3 * SLOT_VOXELS * 4),
      new Uint8Array(GRID_RES ** 3 * 4),
      Array.from({ length: tiles ** 3 }, (_, at) => at).reverse(),
    )
  }

  /** How many bricks are allocated. */
  get brickCount(): number {
    return this.tiles ** 3 - this.free.length
  }

  /** The world point at a voxel's centre. */
  worldAt(x: number, y: number, z: number): [number, number, number] {
    return [this.origin[0] + (x + 0.5) * this.voxelSize, this.origin[1] + (y + 0.5) * this.voxelSize, this.origin[2] + (z + 0.5) * this.voxelSize]
  }

  /** The voxel a world point falls in, which may be outside the field. */
  voxelAt(wx: number, wy: number, wz: number): [number, number, number] {
    return [Math.floor((wx - this.origin[0]) / this.voxelSize), Math.floor((wy - this.origin[1]) / this.voxelSize), Math.floor((wz - this.origin[2]) / this.voxelSize)]
  }

  private slotOf(bx: number, by: number, bz: number): number | undefined {
    if (bx < 0 || by < 0 || bz < 0 || bx >= GRID_RES || by >= GRID_RES || bz >= GRID_RES) return undefined
    let at = ((bz * GRID_RES + by) * GRID_RES + bx) * 4
    if (this.indirection[at + 3] === 0) return undefined
    return this.indirection[at]! + this.indirection[at + 1]! * this.tiles + this.indirection[at + 2]! * this.tiles * this.tiles
  }

  /** Gives a brick a slot if it has none; false when the pool is full (the write is dropped). */
  private ensureBrick(bx: number, by: number, bz: number): boolean {
    if (bx < 0 || by < 0 || bz < 0 || bx >= GRID_RES || by >= GRID_RES || bz >= GRID_RES) return false
    let at = ((bz * GRID_RES + by) * GRID_RES + bx) * 4
    if (this.indirection[at + 3] !== 0) return true
    let slot = this.free.pop()
    if (slot === undefined) return false
    this.indirection[at] = slot % this.tiles
    this.indirection[at + 1] = Math.floor(slot / this.tiles) % this.tiles
    this.indirection[at + 2] = Math.floor(slot / (this.tiles * this.tiles))
    this.indirection[at + 3] = 255
    return true
  }

  /** Where a slot's texel (lx, ly, lz) sits in `pool`. */
  private offsetOf(slot: number, lx: number, ly: number, lz: number): number {
    let x = (slot % this.tiles) * SLOT + lx
    let y = (Math.floor(slot / this.tiles) % this.tiles) * SLOT + ly
    let z = Math.floor(slot / (this.tiles * this.tiles)) * SLOT + lz
    let edge = this.tiles * SLOT
    return ((z * edge + y) * edge + x) * 4
  }

  /** Writes a voxel and its gutter copies; says whether any byte changed (repaints of one colour are dead). */
  set(x: number, y: number, z: number, colour: Texel): boolean {
    let bx = Math.floor(x / BRICK)
    let by = Math.floor(y / BRICK)
    let bz = Math.floor(z / BRICK)
    if (!this.ensureBrick(bx, by, bz)) return false
    let slot = this.slotOf(bx, by, bz)!
    let i = x - bx * BRICK
    let j = y - by * BRICK
    let k = z - bz * BRICK
    let r = clampByte(colour.r)
    let g = clampByte(colour.g)
    let b = clampByte(colour.b)
    let a = clampByte(colour.a)
    let changed = false
    for (let lx of BORDER[i]!) {
      for (let ly of BORDER[j]!) {
        for (let lz of BORDER[k]!) {
          let at = this.offsetOf(slot, lx, ly, lz)
          if (this.pool[at] === r && this.pool[at + 1] === g && this.pool[at + 2] === b && this.pool[at + 3] === a) continue
          this.pool[at] = r
          this.pool[at + 1] = g
          this.pool[at + 2] = b
          this.pool[at + 3] = a
          changed = true
          this.sinceSync = true
        }
      }
    }
    if (changed) this.dirty.add(slot)
    return changed
  }

  /** Reads a voxel; an unallocated brick reads as clear. */
  get(x: number, y: number, z: number): Texel {
    let bx = Math.floor(x / BRICK)
    let by = Math.floor(y / BRICK)
    let bz = Math.floor(z / BRICK)
    let slot = this.slotOf(bx, by, bz)
    if (slot === undefined) return { r: 0, g: 0, b: 0, a: 0 }
    let at = this.offsetOf(slot, x - bx * BRICK + 1, y - by * BRICK + 1, z - bz * BRICK + 1)
    return { r: this.pool[at]!, g: this.pool[at + 1]!, b: this.pool[at + 2]!, a: this.pool[at + 3]! }
  }

  /** Clears every voxel in a region. */
  clearRegion(region: Region): void {
    for (let z = region.z0; z <= region.z1; z++) {
      for (let y = region.y0; y <= region.y1; y++) {
        for (let x = region.x0; x <= region.x1; x++) {
          let bx = Math.floor(x / BRICK)
          let by = Math.floor(y / BRICK)
          let bz = Math.floor(z / BRICK)
          let slot = this.slotOf(bx, by, bz)
          if (slot === undefined) continue
          let at = this.offsetOf(slot, x - bx * BRICK + 1, y - by * BRICK + 1, z - bz * BRICK + 1)
          if (this.pool[at + 3] === 0) continue
          this.pool[at] = 0
          this.pool[at + 1] = 0
          this.pool[at + 2] = 0
          this.pool[at + 3] = 0
          this.dirty.add(slot)
          this.sinceSync = true
        }
      }
    }
  }

  /** Clears everything and releases every brick. */
  clearAll(): void {
    this.pool.fill(0)
    this.indirection.fill(0)
    this.free = Array.from({ length: this.tiles ** 3 }, (_, at) => at).reverse()
    this.dirty.clear()
    this.sinceSync = true
  }

  /** The slots touched since the last call, and forgets them. */
  takeDirty(): number[] {
    let taken = [...this.dirty]
    this.dirty.clear()
    return taken
  }

  /** Whether anything was written since `markSynced`, for a whole upload. */
  get dirtySinceSync(): boolean {
    return this.sinceSync
  }

  /** Says the GPU now holds everything written so far. */
  markSynced = (): void => {
    this.sinceSync = false
  }

  markChanged = (): void => {
    this.sinceSync = true
  }
}
