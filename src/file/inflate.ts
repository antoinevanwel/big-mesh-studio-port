// A raw DEFLATE decoder (RFC 1951), for reading zip entries the web build
// of the modeller wrote compressed. The runtime has no DecompressionStream,
// and the files are small, so a straightforward table-free decoder does.

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DISTANCE_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DISTANCE_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

/** A canonical Huffman code: how many codes of each length, and the symbols in code order. */
interface Huffman {
  counts: Uint16Array
  symbols: Uint16Array
}

const huffman = (lengths: ArrayLike<number>): Huffman => {
  let counts = new Uint16Array(16)
  for (let i = 0; i < lengths.length; i++) counts[lengths[i]!]!++
  counts[0] = 0
  let offsets = new Uint16Array(16)
  for (let len = 1; len < 16; len++) offsets[len] = offsets[len - 1]! + counts[len - 1]!
  let symbols = new Uint16Array(lengths.length)
  for (let i = 0; i < lengths.length; i++) if (lengths[i]! !== 0) symbols[offsets[lengths[i]!]!++] = i
  return { counts, symbols }
}

const FIXED_LITERALS = huffman(Array.from({ length: 288 }, (_, i) => (i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8)))
const FIXED_DISTANCES = huffman(Array.from({ length: 30 }, () => 5))

export const inflate = (input: Uint8Array): Uint8Array => {
  let out = new Uint8Array(Math.max(1024, input.length * 4))
  let written = 0
  let at = 0
  let bitBuffer = 0
  let bitCount = 0

  let need = (count: number): void => {
    if (written + count <= out.length) return
    let length = out.length * 2
    while (length < written + count) length *= 2
    let grown = new Uint8Array(length)
    grown.set(out.subarray(0, written))
    out = grown
  }
  let bits = (count: number): number => {
    while (bitCount < count) {
      if (at >= input.length) throw new Error("the compressed data ends early")
      bitBuffer |= input[at++]! << bitCount
      bitCount += 8
    }
    let value = bitBuffer & ((1 << count) - 1)
    bitBuffer >>>= count
    bitCount -= count
    return value
  }
  let decode = (code: Huffman): number => {
    let value = 0
    let first = 0
    let index = 0
    for (let len = 1; len < 16; len++) {
      value |= bits(1)
      let count = code.counts[len]!
      if (value - first < count) return code.symbols[index + value - first]!
      index += count
      first = (first + count) << 1
      value <<= 1
    }
    throw new Error("the compressed data holds an invalid code")
  }
  let block = (literals: Huffman, distances: Huffman): void => {
    for (;;) {
      let symbol = decode(literals)
      if (symbol < 256) {
        need(1)
        out[written++] = symbol
      } else if (symbol === 256) {
        return
      } else {
        symbol -= 257
        let length = LENGTH_BASE[symbol]! + bits(LENGTH_EXTRA[symbol]!)
        let d = decode(distances)
        let distance = DISTANCE_BASE[d]! + bits(DISTANCE_EXTRA[d]!)
        if (distance > written) throw new Error("the compressed data refers back past its start")
        need(length)
        for (let i = 0; i < length; i++, written++) out[written] = out[written - distance]!
      }
    }
  }

  let last = 0
  while (!last) {
    last = bits(1)
    let type = bits(2)
    if (type === 0) {
      bitBuffer = 0
      bitCount = 0
      if (at + 4 > input.length) throw new Error("the compressed data ends early")
      let length = input[at]! | (input[at + 1]! << 8)
      at += 4
      if (at + length > input.length) throw new Error("the compressed data ends early")
      need(length)
      out.set(input.subarray(at, at + length), written)
      written += length
      at += length
    } else if (type === 1) {
      block(FIXED_LITERALS, FIXED_DISTANCES)
    } else if (type === 2) {
      let literalCount = bits(5) + 257
      let distanceCount = bits(5) + 1
      let codeCount = bits(4) + 4
      let codeLengths = new Uint8Array(19)
      for (let i = 0; i < codeCount; i++) codeLengths[CODE_LENGTH_ORDER[i]!] = bits(3)
      let lengthCode = huffman(codeLengths)
      let lengths = new Uint8Array(literalCount + distanceCount)
      for (let i = 0; i < lengths.length; ) {
        let symbol = decode(lengthCode)
        if (symbol < 16) {
          lengths[i++] = symbol
          continue
        }
        let repeat: number
        let value = 0
        if (symbol === 16) {
          if (i === 0) throw new Error("the compressed data repeats a length before the first")
          value = lengths[i - 1]!
          repeat = 3 + bits(2)
        } else if (symbol === 17) {
          repeat = 3 + bits(3)
        } else {
          repeat = 11 + bits(7)
        }
        if (i + repeat > lengths.length) throw new Error("the compressed data holds too many lengths")
        while (repeat--) lengths[i++] = value
      }
      block(huffman(lengths.subarray(0, literalCount)), huffman(lengths.subarray(literalCount)))
    } else {
      throw new Error("the compressed data uses a reserved block type")
    }
  }
  return out.slice(0, written)
}
