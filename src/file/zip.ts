// Zip archives: written with stored (uncompressed) entries, read with
// stored or deflated ones. A project file and a 3MF print are both zips;
// the files are small, so storing them costs a few kilobytes and keeps the
// writer to a CRC and two headers per entry.

import { inflate } from "./inflate"

const CRC_TABLE = (() => {
  let table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  readonly name: string
  readonly data: Uint8Array | string
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// 1980-01-01 00:00, the earliest time a zip can say; the entries carry no
// meaningful time and a fixed one keeps two writes of a model identical.
const DOS_DATE = (1 << 5) | 1
const DOS_TIME = 0

export const writeZip = (entries: readonly ZipEntry[]): Uint8Array => {
  let files = entries.map(entry => {
    let name = encoder.encode(entry.name)
    let data = typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data
    return { name, data, crc: crc32(data), offset: 0 }
  })
  let size = 22
  for (let file of files) size += 30 + file.name.length + file.data.length + 46 + file.name.length
  let out = new Uint8Array(size)
  let view = new DataView(out.buffer)
  let at = 0

  for (let file of files) {
    file.offset = at
    view.setUint32(at, 0x04034b50, true)
    view.setUint16(at + 4, 20, true)
    view.setUint16(at + 6, 0x0800, true) // names are UTF-8
    view.setUint16(at + 8, 0, true) // stored
    view.setUint16(at + 10, DOS_TIME, true)
    view.setUint16(at + 12, DOS_DATE, true)
    view.setUint32(at + 14, file.crc, true)
    view.setUint32(at + 18, file.data.length, true)
    view.setUint32(at + 22, file.data.length, true)
    view.setUint16(at + 26, file.name.length, true)
    view.setUint16(at + 28, 0, true)
    out.set(file.name, at + 30)
    out.set(file.data, at + 30 + file.name.length)
    at += 30 + file.name.length + file.data.length
  }

  let directory = at
  for (let file of files) {
    view.setUint32(at, 0x02014b50, true)
    view.setUint16(at + 4, 20, true)
    view.setUint16(at + 6, 20, true)
    view.setUint16(at + 8, 0x0800, true)
    view.setUint16(at + 10, 0, true)
    view.setUint16(at + 12, DOS_TIME, true)
    view.setUint16(at + 14, DOS_DATE, true)
    view.setUint32(at + 16, file.crc, true)
    view.setUint32(at + 20, file.data.length, true)
    view.setUint32(at + 24, file.data.length, true)
    view.setUint16(at + 28, file.name.length, true)
    view.setUint32(at + 42, file.offset, true)
    out.set(file.name, at + 46)
    at += 46 + file.name.length
  }

  view.setUint32(at, 0x06054b50, true)
  view.setUint16(at + 8, files.length, true)
  view.setUint16(at + 10, files.length, true)
  view.setUint32(at + 12, at - directory, true)
  view.setUint32(at + 16, directory, true)
  return out
}

/** A zip's entries by name, read lazily; throws a sentence when the bytes are not a zip. */
export class ZipReader {
  private readonly entries = new Map<string, { method: number; offset: number; compressed: number; size: number; crc: number }>()

  constructor(private readonly bytes: Uint8Array) {
    let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let end = -1
    for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
      if (view.getUint32(at, true) === 0x06054b50) {
        end = at
        break
      }
    }
    if (end < 0) throw new Error("not a zip archive")
    let count = view.getUint16(end + 10, true)
    let at = view.getUint32(end + 16, true)
    for (let i = 0; i < count; i++) {
      if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw new Error("the zip's directory is damaged")
      let nameLength = view.getUint16(at + 28, true)
      let extraLength = view.getUint16(at + 30, true)
      let commentLength = view.getUint16(at + 32, true)
      let name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength))
      this.entries.set(name, {
        method: view.getUint16(at + 10, true),
        crc: view.getUint32(at + 16, true),
        compressed: view.getUint32(at + 20, true),
        size: view.getUint32(at + 24, true),
        offset: view.getUint32(at + 42, true),
      })
      at += 46 + nameLength + extraLength + commentLength
    }
  }

  has(name: string): boolean {
    return this.entries.has(name)
  }

  bytesOf(name: string): Uint8Array | undefined {
    let entry = this.entries.get(name)
    if (entry === undefined) return undefined
    let view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength)
    if (view.getUint32(entry.offset, true) !== 0x04034b50) throw new Error(`the zip entry ${name} is damaged`)
    let start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true)
    let raw = this.bytes.subarray(start, start + entry.compressed)
    let data: Uint8Array
    if (entry.method === 0) data = raw.slice()
    else if (entry.method === 8) data = inflate(raw)
    else throw new Error(`the zip entry ${name} uses compression method ${entry.method}`)
    if (data.length !== entry.size || crc32(data) !== entry.crc) throw new Error(`the zip entry ${name} is damaged`)
    return data
  }

  textOf(name: string): string | undefined {
    let data = this.bytesOf(name)
    return data === undefined ? undefined : decoder.decode(data)
  }
}
