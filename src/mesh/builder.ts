// The mesh a mesher writes into: positions, normals, a paint key per vertex
// and a triangle list. Typed arrays that double as they fill, so a rebuild
// allocates a handful of times rather than once per vertex.

type Growing = Float32Array | Uint32Array

class Growable<T extends Growing> {
  private buffer: T
  size = 0

  constructor(private readonly make: (length: number) => T, initial = 1024) {
    this.buffer = make(initial)
  }

  reserve(extra: number): T {
    let needed = this.size + extra
    if (needed > this.buffer.length) {
      let length = this.buffer.length
      while (length < needed) length *= 2
      let grown = this.make(length)
      grown.set(this.buffer)
      this.buffer = grown
    }
    return this.buffer
  }

  push(value: number): void {
    this.reserve(1)[this.size++] = value
  }

  get array(): T {
    return this.buffer
  }

  exact(): T {
    return this.buffer.slice(0, this.size) as T
  }
}

/** A finished mesh. `paints` holds one PaintKey per vertex. */
export interface MeshData {
  readonly positions: Float32Array
  readonly normals: Float32Array
  readonly paints: Uint32Array
  readonly indices: Uint32Array
  readonly vertexCount: number
  readonly triangleCount: number
}

export const EMPTY_MESH: MeshData = {
  positions: new Float32Array(0),
  normals: new Float32Array(0),
  paints: new Uint32Array(0),
  indices: new Uint32Array(0),
  vertexCount: 0,
  triangleCount: 0,
}

/** Where a mesher puts what it finds. Quads split along their a-c diagonal. */
export class MeshBuilder {
  private readonly positions = new Growable(n => new Float32Array(n), 3 * 2048)
  private readonly indices = new Growable(n => new Uint32Array(n), 3 * 4096)

  get vertexCount(): number {
    return this.positions.size / 3
  }

  get triangleCount(): number {
    return this.indices.size / 3
  }

  vertex(x: number, y: number, z: number): number {
    let index = this.vertexCount
    let buffer = this.positions.reserve(3)
    buffer[this.positions.size++] = x
    buffer[this.positions.size++] = y
    buffer[this.positions.size++] = z
    return index
  }

  triangle(a: number, b: number, c: number): void {
    let buffer = this.indices.reserve(3)
    buffer[this.indices.size++] = a
    buffer[this.indices.size++] = b
    buffer[this.indices.size++] = c
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.triangle(a, b, c)
    this.triangle(a, c, d)
  }

  /** The positions written so far, for a pass that reads them back. */
  positionAt(index: number, axis: number): number {
    return this.positions.array[index * 3 + axis]!
  }

  finish(): MeshData {
    let vertexCount = this.vertexCount
    return {
      positions: this.positions.exact(),
      normals: new Float32Array(vertexCount * 3),
      paints: new Uint32Array(vertexCount),
      indices: this.indices.exact(),
      vertexCount,
      triangleCount: this.triangleCount,
    }
  }
}
