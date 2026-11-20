import { deflateSync } from 'fflate'

/**
 * A ZIP written as it goes, never held whole in memory, that any reader opens however big it
 * gets: past 4 GiB of files, or 65,535 of them, it adds the ZIP64 records that say the sizes,
 * places and count the classic fields can't hold (APPNOTE 6.3.10, sections 4.3.9, 4.3.14,
 * 4.3.15 and 4.5.3). Texts are compressed in memory; files are stored as they come, their size
 * and CRC-32 written after them.
 */

/** The most a classic field holds; that value itself says "see the ZIP64 record". */
const MAX32 = 0xffffffff
const MAX16 = 0xffff
/** Names in UTF-8 (bit 11), and for a file streamed, its CRC-32 and sizes after it (bit 3). */
const UTF8 = 0x0800
const DESCRIPTOR = 0x0008
/** The biggest ZIP64 record in an extra field: three values of 8 bytes. */
const ZIP64_EXTRA_MAX = 4 + 3 * 8
const STORED = 0
const DEFLATED = 8
/** Version 2.0 reads deflate; 4.5 is needed for ZIP64. Made by: MS-DOS attributes (none). */
const V20 = 20
const V45 = 45

interface Entry {
  name: Uint8Array
  flags: number
  method: number
  time: number
  date: number
  crc: number
  compressed: number
  size: number
  offset: number
  /** Written with a ZIP64 record in its local header: its sizes after it take 8 bytes each. */
  zip64: boolean
  /**
   * For a name that isn't ASCII, Info-ZIP's Unicode Path extra field (APPNOTE 4.6.9) as well as
   * bit 11: Info-ZIP's unzip 6.0 takes the name of an entry past 4 GiB for one in another code
   * page without it, and says its two names don't match.
   */
  unicode: Uint8Array
}

export interface ZipOptions {
  /** ZIP64 records for every entry and at the end, needed or not (to check readers with small files). */
  alwaysZip64?: boolean
}

export class ZipWriter {
  private offset = 0
  private readonly entries: Entry[] = []
  private readonly encoder = new TextEncoder()

  /** `write` takes each piece in order; the ZIP waits for it, which is how a slow reader slows it down. */
  constructor(
    private readonly write: (chunk: Uint8Array) => Promise<void>,
    private readonly options: ZipOptions = {},
  ) {}

  /** A text (or any data held in memory), compressed. */
  async add(name: string, data: Uint8Array, date = new Date()) {
    const compressed = deflateSync(data, { level: 6 })
    const entry = this.entry(name, date, DEFLATED, 0)
    entry.crc = crc32(data)
    entry.compressed = compressed.length
    entry.size = data.length
    entry.zip64 = Boolean(this.options.alwaysZip64) || entry.size >= MAX32 || entry.compressed >= MAX32
    await this.put(localHeader(entry))
    await this.put(compressed)
  }

  /**
   * A file of `size` bytes, read from `body` as it is written: stored as it is (attachments are
   * mostly compressed already). It must be `size` bytes long, or the ZIP stops there with an error.
   */
  async addStream(name: string, size: number, body: ReadableStream<Uint8Array>, date = new Date()) {
    const entry = this.entry(name, date, STORED, DESCRIPTOR)
    entry.zip64 = Boolean(this.options.alwaysZip64) || size >= MAX32
    await this.put(localHeader(entry))
    let crc = ~0
    let length = 0
    const reader = body.getReader()
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        length += value.length
        if (length > size) throw new Error(`${name} is longer than its ${size} bytes`)
        crc = crc32Update(crc, value)
        await this.put(value)
      }
    } catch (error) {
      // Stopped half-way (the browser went away, the file was longer): the file being read is let go.
      await reader.cancel(error).catch(() => {})
      throw error
    } finally {
      reader.releaseLock()
    }
    if (length !== size) throw new Error(`${name} has ${length} bytes, not ${size}`)
    entry.crc = ~crc >>> 0
    entry.compressed = entry.size = length
    await this.put(dataDescriptor(entry))
  }

  /** The central directory, and the records at the end that say where it is. */
  async end() {
    const start = this.offset
    for (const entry of this.entries) await this.put(centralHeader(entry, Boolean(this.options.alwaysZip64)))
    const size = this.offset - start
    const count = this.entries.length
    const zip64 = Boolean(this.options.alwaysZip64) || count >= MAX16 || size >= MAX32 || start >= MAX32
    if (zip64) {
      const record = this.offset
      await this.put(zip64End(count, size, start))
      await this.put(zip64Locator(record))
    }
    await this.put(end(zip64 ? MAX16 : count, zip64 ? MAX32 : size, zip64 ? MAX32 : start))
  }

  private entry(name: string, date: Date, method: number, flags: number): Entry {
    const bytes = this.encoder.encode(name)
    if (bytes.length > MAX16) throw new Error(`The name ${name.slice(0, 80)}… is longer than a ZIP holds (65,535 bytes)`)
    // Version 1, the CRC-32 of the name field it stands for, and the name in UTF-8; left out when
    // it wouldn't fit with a ZIP64 record in the extra field (bit 11 says the same).
    const fits = 9 + bytes.length + ZIP64_EXTRA_MAX <= MAX16
    const unicode = bytes.length === name.length || !fits ? new Uint8Array(0) : new Record(9 + bytes.length).u16(0x7075).u16(5 + bytes.length).raw(new Uint8Array([1])).u32(crc32(bytes)).raw(bytes).bytes
    const entry: Entry = { name: bytes, flags: UTF8 | flags, method, ...dos(date), crc: 0, compressed: 0, size: 0, offset: this.offset, zip64: false, unicode }
    this.entries.push(entry)
    return entry
  }

  private async put(chunk: Uint8Array) {
    if (!chunk.length) return
    this.offset += chunk.length
    await this.write(chunk)
  }
}

/** Date and time as MS-DOS keeps them (local time, two-second steps, from 1980). */
function dos(date: Date) {
  const year = Math.max(1980, date.getFullYear())
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

/** A little-endian record, filled field by field. */
class Record {
  readonly bytes: Uint8Array
  private readonly view: DataView
  private at = 0

  constructor(size: number) {
    this.bytes = new Uint8Array(size)
    this.view = new DataView(this.bytes.buffer)
  }

  u16(value: number) {
    // A value that doesn't fit would wrap round, and every reader would then lose its way.
    if (value > MAX16) throw new Error(`${value} does not fit in a ZIP field of 2 bytes`)
    this.view.setUint16(this.at, value, true)
    this.at += 2
    return this
  }

  u32(value: number) {
    this.view.setUint32(this.at, value >>> 0, true)
    this.at += 4
    return this
  }

  u64(value: number) {
    this.view.setBigUint64(this.at, BigInt(value), true)
    this.at += 8
    return this
  }

  raw(bytes: Uint8Array) {
    this.bytes.set(bytes, this.at)
    this.at += bytes.length
    return this
  }
}

const concat = (a: Uint8Array, b: Uint8Array) => {
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

/** The ZIP64 extended information extra field (id 1) with the given 8-byte values. */
function zip64Extra(values: number[]) {
  const record = new Record(4 + values.length * 8).u16(0x0001).u16(values.length * 8)
  for (const value of values) record.u64(value)
  return record.bytes
}

function localHeader(entry: Entry) {
  const streamed = (entry.flags & DESCRIPTOR) !== 0
  // With ZIP64, both sizes go in the extra field (zero for a file whose sizes come after it), and
  // the classic fields say to look there.
  const extra = concat(entry.zip64 ? zip64Extra(streamed ? [0, 0] : [entry.size, entry.compressed]) : new Uint8Array(0), entry.unicode)
  const record = new Record(30 + entry.name.length + extra.length)
    .u32(0x04034b50)
    .u16(entry.zip64 ? V45 : V20)
    .u16(entry.flags)
    .u16(entry.method)
    .u16(entry.time)
    .u16(entry.date)
    .u32(streamed ? 0 : entry.crc)
  if (entry.zip64) record.u32(MAX32).u32(MAX32)
  else record.u32(streamed ? 0 : entry.compressed).u32(streamed ? 0 : entry.size)
  return record.u16(entry.name.length).u16(extra.length).raw(entry.name).raw(extra).bytes
}

/** After a streamed file: its CRC-32 and sizes, in 8 bytes each when its local header has a ZIP64 record. */
function dataDescriptor(entry: Entry) {
  const record = new Record(entry.zip64 ? 24 : 16).u32(0x08074b50).u32(entry.crc)
  if (entry.zip64) return record.u64(entry.compressed).u64(entry.size).bytes
  return record.u32(entry.compressed).u32(entry.size).bytes
}

function centralHeader(entry: Entry, always: boolean) {
  // Each value too big for its field (or every one, when asked) goes in the ZIP64 record, in this order.
  const big = (value: number) => always || value >= MAX32
  const values = [entry.size, entry.compressed, entry.offset].filter(big)
  const extra = concat(values.length ? zip64Extra(values) : new Uint8Array(0), entry.unicode)
  const version = values.length || entry.zip64 ? V45 : V20
  return new Record(46 + entry.name.length + extra.length)
    .u32(0x02014b50)
    .u16(version)
    .u16(version)
    .u16(entry.flags)
    .u16(entry.method)
    .u16(entry.time)
    .u16(entry.date)
    .u32(entry.crc)
    .u32(big(entry.compressed) ? MAX32 : entry.compressed)
    .u32(big(entry.size) ? MAX32 : entry.size)
    .u16(entry.name.length)
    .u16(extra.length)
    .u16(0) // comment
    .u16(0) // disk
    .u16(0) // internal attributes
    .u32(0) // external attributes
    .u32(big(entry.offset) ? MAX32 : entry.offset)
    .raw(entry.name)
    .raw(extra).bytes
}

function zip64End(count: number, size: number, offset: number) {
  return new Record(56)
    .u32(0x06064b50)
    .u64(44) // the size of the rest of this record
    .u16(V45)
    .u16(V45)
    .u32(0) // this disk
    .u32(0) // the disk where the central directory starts
    .u64(count)
    .u64(count)
    .u64(size)
    .u64(offset).bytes
}

function zip64Locator(record: number) {
  return new Record(20).u32(0x07064b50).u32(0).u64(record).u32(1).bytes
}

function end(count: number, size: number, offset: number) {
  return new Record(22).u32(0x06054b50).u16(0).u16(0).u16(count).u16(count).u32(size).u32(offset).u16(0).bytes
}

/** CRC-32 (IEEE), eight bytes at a time. */
const TABLES = (() => {
  const tables = new Int32Array(256 * 8)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    tables[n] = c
  }
  for (let n = 0; n < 256; n++) {
    let c = tables[n]!
    for (let t = 1; t < 8; t++) {
      c = tables[c & 0xff]! ^ (c >>> 8)
      tables[t * 256 + n] = c
    }
  }
  return tables
})()

function crc32Update(crc: number, data: Uint8Array) {
  const t = TABLES
  let c = crc
  let i = 0
  const end8 = data.length - (data.length % 8)
  for (; i < end8; i += 8) {
    const a = c ^ (data[i]! | (data[i + 1]! << 8) | (data[i + 2]! << 16) | (data[i + 3]! << 24))
    c =
      t[1792 + (a & 0xff)]! ^
      t[1536 + ((a >>> 8) & 0xff)]! ^
      t[1280 + ((a >>> 16) & 0xff)]! ^
      t[1024 + (a >>> 24)]! ^
      t[768 + data[i + 4]!]! ^
      t[512 + data[i + 5]!]! ^
      t[256 + data[i + 6]!]! ^
      t[data[i + 7]!]!
  }
  for (; i < data.length; i++) c = t[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)
  return c
}

export function crc32(data: Uint8Array) {
  return ~crc32Update(~0, data) >>> 0
}
