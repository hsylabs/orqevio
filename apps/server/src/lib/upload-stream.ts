/** Thrown when an upload ends early or carries more bytes than it announced. */
export class LengthMismatchError extends Error {
  constructor() {
    super('The upload did not match its declared length')
  }
}

/**
 * Reads at least the first `n` bytes of `source` (fewer if it is shorter) and
 * returns them with a stream that still yields every byte, head included.
 */
export async function peek(source: ReadableStream<Uint8Array>, n: number) {
  const reader = source.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (length < n) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    length += value.byteLength
  }
  const head = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    head.set(chunk, offset)
    offset += chunk.byteLength
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (head.byteLength) controller.enqueue(head)
    },
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) controller.close()
      else controller.enqueue(value)
    },
    cancel: (reason) => reader.cancel(reason),
  })
  return { head: head.subarray(0, n), stream }
}

/** Passes bytes through and errors if the stream turns out longer or shorter than `size`. */
export function exactLength(size: number) {
  let seen = 0
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength
      if (seen > size) controller.error(new LengthMismatchError())
      else controller.enqueue(chunk)
    },
    flush(controller) {
      if (seen !== size) controller.error(new LengthMismatchError())
    },
  })
}
