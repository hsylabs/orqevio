import { createHash } from 'node:crypto'

/**
 * A stream that lets bytes through as they come and, once they all have, says how many there were
 * and their SHA-256: a file is checked while it is copied, without holding it in memory.
 */
export function measure() {
  const hash = createHash('sha256')
  let bytes = 0
  let digest: string | null = null
  const stream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      hash.update(chunk)
      bytes += chunk.length
      controller.enqueue(chunk)
    },
    flush() {
      digest = hash.digest('hex')
    },
  })
  return {
    stream,
    /** What went through, once all of it has. */
    result: () => {
      if (digest === null) throw new Error('Not measured yet')
      return { bytes, sha256: digest }
    },
  }
}

/** The size and SHA-256 of a whole stream, reading it to the end. */
export async function measureAll(body: ReadableStream<Uint8Array>) {
  const measured = measure()
  await body.pipeThrough(measured.stream).pipeTo(new WritableStream())
  return measured.result()
}
