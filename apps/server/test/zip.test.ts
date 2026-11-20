import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, open, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ZipWriter, type ZipOptions } from '../src/lib/zip'

const folders: string[] = []
afterAll(async () => {
  for (const dir of folders) await rm(dir, { recursive: true, force: true })
})

/** One piece of zeros, given again and again for a big file: the file on disk keeps a hole there instead. */
const ZEROS = new Uint8Array(8 * 1024 * 1024)

/**
 * Writes a ZIP to a file, as the export streams it. Pieces of ZEROS are skipped, not written, so
 * an archive of several GiB takes almost no disk.
 */
async function zipFile(build: (zip: ZipWriter) => Promise<void>, options?: ZipOptions) {
  const dir = await mkdtemp(path.join(tmpdir(), 'orqevio-zip-'))
  folders.push(dir)
  const file = path.join(dir, 'test.zip')
  const handle = await open(file, 'w')
  let at = 0
  const zip = new ZipWriter(async (chunk) => {
    if (chunk !== ZEROS) await handle.write(chunk, 0, chunk.length, at)
    at += chunk.length
  }, options)
  try {
    await build(zip)
    await zip.end()
    await handle.truncate(at)
  } finally {
    await handle.close()
  }
  return { file, bytes: at }
}

const stream = (...pieces: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(piece)
      controller.close()
    },
  })

/** A big file of zeros, `size` bytes, given in pieces of ZEROS (the last one cut to size). */
function zeros(size: number) {
  let left = size
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (left <= 0) return controller.close()
      const piece = left >= ZEROS.length ? ZEROS : ZEROS.subarray(0, left)
      left -= piece.length
      controller.enqueue(piece)
    },
  })
}

/**
 * What Python's zipfile (a standard reader, ZIP64 included) finds: each entry's name, size and
 * CRC-32 as the central directory says, whether every entry reads back with its CRC-32 (testzip),
 * and the text of the small ones.
 */
function python(file: string) {
  const script = `
import json, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    infos = z.infolist()
    print(json.dumps({
        "entries": [{"name": i.filename, "size": i.file_size, "crc": i.CRC, "offset": i.header_offset} for i in infos],
        "bad": z.testzip(),
        "texts": {i.filename: z.read(i).decode("utf-8") for i in infos if i.file_size < 4096},
    }))
`
  const out = execFileSync('python3', ['-I', '-c', script, file], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  return JSON.parse(out) as { entries: Array<{ name: string; size: number; crc: number; offset: number }>; bad: string | null; texts: Record<string, string> }
}

/** Info-ZIP's unzip, testing every entry: another reader, which also checks the local headers against the central directory. */
const unzipTest = (file: string) => execFileSync('unzip', ['-tqq', file], { encoding: 'utf8' })

const has = async (file: string, signature: number) => {
  const bytes = await readFile(file)
  const pattern = Buffer.alloc(4)
  pattern.writeUInt32LE(signature)
  return bytes.includes(pattern)
}
const ZIP64_END = 0x06064b50

const utf8 = (text: string) => new TextEncoder().encode(text)

describe('the ZIP of an export', () => {
  it('holds texts and files any reader opens, names in any script included', async () => {
    const photo = new Uint8Array(randomBytes(300_000))
    const { file } = await zipFile(async (zip) => {
      await zip.add('orqevio/export.json', utf8('{"format":"orqevio-export"}\n'))
      await zip.add('orqevio/Espacio/documentos/Año nuevo — 日本.md', utf8('# Año nuevo\n\nÑandú 🦤\n'))
      await zip.add('orqevio/vacío.txt', new Uint8Array(0))
      await zip.addStream('orqevio/Espacio/foto.jpg', photo.length, stream(photo.subarray(0, 1000), photo.subarray(1000)))
      await zip.addStream('orqevio/Espacio/nada.bin', 0, stream())
    })
    const found = python(file)
    expect(found.bad).toBeNull()
    expect(found.entries.map((e) => [e.name, e.size])).toEqual([
      ['orqevio/export.json', 28],
      ['orqevio/Espacio/documentos/Año nuevo — 日本.md', utf8('# Año nuevo\n\nÑandú 🦤\n').length],
      ['orqevio/vacío.txt', 0],
      ['orqevio/Espacio/foto.jpg', 300_000],
      ['orqevio/Espacio/nada.bin', 0],
    ])
    expect(found.texts['orqevio/Espacio/documentos/Año nuevo — 日本.md']).toBe('# Año nuevo\n\nÑandú 🦤\n')
    unzipTest(file)
    // Small: no ZIP64 records, for the oldest readers.
    expect(await has(file, ZIP64_END)).toBe(false)
  })

  it('writes ZIP64 records that readers follow, for every entry and at the end', async () => {
    const data = new Uint8Array(randomBytes(70_000))
    const { file } = await zipFile(
      async (zip) => {
        await zip.add('a.txt', utf8('uno'))
        await zip.addStream('b.bin', data.length, stream(data))
        await zip.add('c.txt', utf8('tres'))
      },
      { alwaysZip64: true },
    )
    expect(await has(file, ZIP64_END)).toBe(true)
    const found = python(file)
    expect(found.bad).toBeNull()
    expect(found.entries.map((e) => [e.name, e.size])).toEqual([
      ['a.txt', 3],
      ['b.bin', 70_000],
      ['c.txt', 4],
    ])
    expect(found.texts['c.txt']).toBe('tres')
    unzipTest(file)
  })

  it('holds more than 65,535 entries', async () => {
    const { file } = await zipFile(async (zip) => {
      for (let i = 0; i < 70_000; i++) await zip.add(`notas/${i}.md`, utf8(`${i}`))
    })
    expect(await has(file, ZIP64_END)).toBe(true)
    const count = execFileSync('python3', ['-I', '-c', 'import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); print(len(z.infolist()), z.read("notas/69999.md").decode())', file], { encoding: 'utf8' })
    expect(count.trim()).toBe('70000 69999')
  })

  it(
    'holds a file of more than 4 GiB, and what comes after it',
    async () => {
      const big = 2 ** 32 + 12_345
      const { file, bytes } = await zipFile(async (zip) => {
        await zip.add('antes.txt', utf8('antes'))
        await zip.addStream('grande.bin', big, zeros(big))
        await zip.add('después.txt', utf8('después'))
      })
      expect(bytes).toBeGreaterThan(big)
      const found = python(file)
      expect(found.bad).toBeNull()
      expect(found.entries.map((e) => [e.name, e.size])).toEqual([
        ['antes.txt', 5],
        ['grande.bin', big],
        ['después.txt', 8],
      ])
      // Past 4 GiB: its place only fits in the ZIP64 record.
      expect(found.entries[2]!.offset).toBeGreaterThan(2 ** 32)
      expect(found.texts['después.txt']).toBe('después')
      unzipTest(file)
    },
    10 * 60 * 1000,
  )

  it('refuses a name longer than a ZIP holds instead of writing a broken one, and keeps one that just fits', async () => {
    await expect(zipFile(async (zip) => zip.add('a'.repeat(65_536), utf8('x')))).rejects.toThrow('longer than a ZIP holds')
    // 65,534 bytes of a name in another script: too long for the Unicode Path field as well, bit 11 says it.
    const { file } = await zipFile(async (zip) => zip.add('ñ'.repeat(32_767), utf8('x')), { alwaysZip64: true })
    const found = python(file)
    expect(found.bad).toBeNull()
    expect(found.entries[0]!.name).toBe('ñ'.repeat(32_767))
  })

  it('lets go of the file it reads when the ZIP stops half-way', async () => {
    let cancelled: unknown = null
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024))
      },
      cancel(reason) {
        cancelled = reason
      },
    })
    let written = 0
    const zip = new ZipWriter(async (chunk) => {
      written += chunk.length
      if (written > 4096) throw new Error('the browser went away')
    })
    await expect(zip.addStream('grande.bin', 1_000_000, body)).rejects.toThrow('the browser went away')
    expect(cancelled).toBeInstanceOf(Error)
  })

  it('stops with an error when a file is not the size it should be', async () => {
    await expect(zipFile(async (zip) => zip.addStream('corto.bin', 10, stream(new Uint8Array(4))))).rejects.toThrow('has 4 bytes, not 10')
    await expect(zipFile(async (zip) => zip.addStream('largo.bin', 2, stream(new Uint8Array(4))))).rejects.toThrow('longer than its 2 bytes')
  })
})
