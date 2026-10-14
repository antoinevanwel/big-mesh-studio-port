// The paint journal: every dab the person has made, in order, and the only
// durable paint state. The field is rasterised from it and can always be
// thrown away and rebuilt; nothing can be rebuilt into a journal. Ported
// from big-mesh-studios' sdf-modeller unwrapping/paint-journal.ts.
//
// Structure-of-arrays in flat typed buffers, growing by doubling, so a
// thousand repaints of one spot are a thousand rows rather than a thousand
// objects. The three counters (`length`, `ends`, `openStart`) are separate
// fields on purpose: upstream's first version folded them into one array
// and appending to an open stroke overwrote where the previous one ended.

import type { RGBA } from "../model/types"

/** Floats a dab occupies in `centre` and `normal`. */
const VEC = 3

/** The bytes one dab costs: centre and normal, radius and hardness, colour, part. */
export const DAB_BYTES = VEC * 4 * 2 + 4 * 2 + 4 + 4

/** One brush mark: a round disc lying on the surface, in the owning part's local space. */
export interface Dab {
  /** Where the dab is, in the owning part's own frame, so paint follows its part. */
  readonly centre: readonly [number, number, number]
  /** Which way the surface faces there, unit length, in the part's frame. */
  readonly normal: readonly [number, number, number]
  /** The disc's radius in world units. */
  readonly radius: number
  /** 0 for an airbrush, 1 for a hard edge. */
  readonly hardness: number
  /** Straight alpha. */
  readonly colour: RGBA
  /** Index of the part this dab belongs to. */
  readonly part: number
}

/** The dabs an undo or a clear took, handed back so the redo can put them back. */
export interface RemovedDabs {
  readonly count: number
  /** Where each removed stroke ended, as dab counts within the removed run. */
  readonly strokes: readonly number[]
  readonly centre: Float32Array
  readonly normal: Float32Array
  readonly radius: Float32Array
  readonly hardness: Float32Array
  readonly colour: Uint8Array
  readonly part: Uint32Array
}

export class PaintJournal {
  centre = new Float32Array(64 * VEC)
  normal = new Float32Array(64 * VEC)
  radius = new Float32Array(64)
  hardness = new Float32Array(64)
  colour = new Uint8Array(64 * 4)
  part = new Uint32Array(64)

  private length = 0
  /** The dab count at the end of every finished stroke, in order. */
  private ends: number[] = []
  /** The dab count when the stroke now being drawn began. */
  private openStartIndex = 0

  get count(): number {
    return this.length
  }

  /** Live rather than a copy: `rasterise` walks it on every pointer move. */
  get strokeEnds(): readonly number[] {
    return this.ends
  }

  /** Where the stroke in progress began, which is where a live re-rasterise starts. */
  get openStart(): number {
    return this.openStartIndex
  }

  /** Finished strokes; one in progress is not one of them. */
  get strokeCount(): number {
    return this.ends.length
  }

  /** How many dabs the stroke in progress holds. */
  get openStrokeCount(): number {
    return this.length - this.openStartIndex
  }

  private grow(): void {
    let capacity = this.radius.length * 2
    let centre = new Float32Array(capacity * VEC)
    centre.set(this.centre)
    this.centre = centre
    let normal = new Float32Array(capacity * VEC)
    normal.set(this.normal)
    this.normal = normal
    let radius = new Float32Array(capacity)
    radius.set(this.radius)
    this.radius = radius
    let hardness = new Float32Array(capacity)
    hardness.set(this.hardness)
    this.hardness = hardness
    let colour = new Uint8Array(capacity * 4)
    colour.set(this.colour)
    this.colour = colour
    let part = new Uint32Array(capacity)
    part.set(this.part)
    this.part = part
  }

  /** Adds a dab to the stroke in progress; the caller ends the stroke when the finger lifts. */
  append(dab: Dab): void {
    if (this.length === this.radius.length) this.grow()
    let at = this.length
    this.centre.set(dab.centre, at * VEC)
    this.normal.set(dab.normal, at * VEC)
    this.radius[at] = dab.radius
    this.hardness[at] = dab.hardness
    this.colour[at * 4] = dab.colour.r
    this.colour[at * 4 + 1] = dab.colour.g
    this.colour[at * 4 + 2] = dab.colour.b
    this.colour[at * 4 + 3] = dab.colour.a
    this.part[at] = dab.part
    this.length = at + 1
  }

  /** Closes the stroke in progress, making it one undo step. An empty stroke leaves no trace. */
  endStroke(): void {
    if (this.length === this.openStartIndex) return
    this.ends.push(this.length)
    this.openStartIndex = this.length
  }

  /**
   * Takes the last finished stroke off and returns its dabs, for a redo.
   * A stroke that never finished (a pointer lost) is dropped silently first.
   */
  undoStroke(): RemovedDabs | undefined {
    if (this.length !== this.openStartIndex) this.length = this.openStartIndex
    if (this.ends.length === 0) return undefined
    let to = this.ends.pop()!
    let from = this.ends.length === 0 ? 0 : this.ends[this.ends.length - 1]!
    this.length = from
    this.openStartIndex = from
    let count = to - from
    if (count === 0) return undefined
    return {
      count,
      strokes: [count],
      centre: this.centre.slice(from * VEC, (from + count) * VEC),
      normal: this.normal.slice(from * VEC, (from + count) * VEC),
      radius: this.radius.slice(from, from + count),
      hardness: this.hardness.slice(from, from + count),
      colour: this.colour.slice(from * 4, (from + count) * 4),
      part: this.part.slice(from, from + count),
    }
  }

  /**
   * Puts back dabs an undo or a clear took, one stroke per removed stroke,
   * so the next undo after a cleared clear takes one stroke, not all of them.
   */
  redoStroke(removed: RemovedDabs): void {
    let from = this.length
    for (let i = 0; i < removed.count; i++) {
      this.append({
        centre: [removed.centre[i * VEC]!, removed.centre[i * VEC + 1]!, removed.centre[i * VEC + 2]!],
        normal: [removed.normal[i * VEC]!, removed.normal[i * VEC + 1]!, removed.normal[i * VEC + 2]!],
        radius: removed.radius[i]!,
        hardness: removed.hardness[i]!,
        colour: { r: removed.colour[i * 4]!, g: removed.colour[i * 4 + 1]!, b: removed.colour[i * 4 + 2]!, a: removed.colour[i * 4 + 3]! },
        part: removed.part[i]!,
      })
    }
    for (let end of removed.strokes) this.ends.push(from + end)
    this.openStartIndex = this.length
  }

  /** Empties the journal and hands back every finished stroke, so a clear can be undone. */
  clearWithUndo = (): RemovedDabs | undefined => {
    let count = this.ends.length === 0 ? 0 : this.ends[this.ends.length - 1]!
    if (count === 0) {
      this.clear()
      return undefined
    }
    let removed: RemovedDabs = {
      count,
      strokes: this.ends.slice(),
      centre: this.centre.slice(0, count * VEC),
      normal: this.normal.slice(0, count * VEC),
      radius: this.radius.slice(0, count),
      hardness: this.hardness.slice(0, count),
      colour: this.colour.slice(0, count * 4),
      part: this.part.slice(0, count),
    }
    this.clear()
    return removed
  }

  clear(): void {
    this.length = 0
    this.ends = []
    this.openStartIndex = 0
  }

  /**
   * Takes on a journal read from a file, replacing what was here. Copied
   * into storage this journal owns: `grow` replaces the arrays, which would
   * detach a view onto the file's buffer.
   */
  adopt = (loaded: {
    readonly dabs: number
    readonly strokes: readonly number[]
    readonly centre: Float32Array
    readonly normal: Float32Array
    readonly radius: Float32Array
    readonly hardness: Float32Array
    readonly colour: Uint8Array
    readonly part: Uint32Array
  }): void => {
    this.clear()
    while (this.radius.length < loaded.dabs) this.grow()
    this.centre.set(loaded.centre)
    this.normal.set(loaded.normal)
    this.radius.set(loaded.radius)
    this.hardness.set(loaded.hardness)
    this.colour.set(loaded.colour)
    this.part.set(loaded.part)
    this.length = loaded.dabs
    this.ends = [...loaded.strokes]
    // A file holds no half-drawn stroke: nothing is open.
    this.openStartIndex = loaded.dabs
  }
}
