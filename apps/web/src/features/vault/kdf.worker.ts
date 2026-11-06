/// <reference lib="webworker" />
import { argon2id } from 'hash-wasm'

interface KdfRequest {
  password: string
  salt: Uint8Array
  memoryKiB: number
  iterations: number
  parallelism: number
}

// Argon2id runs off the main thread so the interface stays fluid while unlocking.
self.onmessage = async (event: MessageEvent<KdfRequest>) => {
  try {
    const { password, salt, memoryKiB, iterations, parallelism } = event.data
    const hash = await argon2id({ password, salt, memorySize: memoryKiB, iterations, parallelism, hashLength: 32, outputType: 'binary' })
    ;(self as unknown as Worker).postMessage({ ok: true, hash }, [hash.buffer])
  } catch (error) {
    ;(self as unknown as Worker).postMessage({ ok: false, error: String(error) })
  }
}
