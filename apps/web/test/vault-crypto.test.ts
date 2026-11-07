import type { VaultStateDTO } from '@orqevio/shared'
import { describe, expect, it } from 'vitest'
import {
  WrongSecretError,
  changeMasterPassword,
  createVault,
  decryptItem,
  encryptItem,
  formatRecoveryKey,
  parseRecoveryKey,
  recoverVault,
  unlockWithPassword,
} from '../src/features/vault/crypto'
import { entropyBits, generatePassword } from '../src/features/vault/generator'
import { emptyItem } from '../src/features/vault/types'

const userId = '5c4f1c1d-e22c-4068-86e8-400ed30622b5'

describe('vault crypto', () => {
  it('creates, unlocks, rotates and recovers a vault without exposing plaintext', async () => {
    const { keys, vaultKey, recoveryKey } = await createVault('master-password-1', userId)
    expect(keys.wrappedKey).toMatch(/^v1\.[\w-]+\.[\w-]+$/)
    expect(keys.kdf.memoryKiB).toBe(65536)
    expect(recoveryKey).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/)

    const item = { ...emptyItem('login'), title: 'Banco', username: 'ana', password: 's3cr3t!' }
    const envelope = await encryptItem(vaultKey, userId, item)
    expect(envelope).not.toContain('s3cr3t')

    const state: VaultStateDTO = { initialized: true, autoLockMinutes: 15, ...keys }
    const unlocked = await unlockWithPassword(state, 'master-password-1', userId)
    expect(await decryptItem(unlocked, userId, item.id, envelope)).toEqual(item)
    await expect(unlockWithPassword(state, 'wrong-password', userId)).rejects.toBeInstanceOf(WrongSecretError)
    // Envelopes are bound to their user and item id (AES-GCM associated data).
    await expect(decryptItem(unlocked, userId, crypto.randomUUID(), envelope)).rejects.toBeInstanceOf(WrongSecretError)
    await expect(decryptItem(unlocked, crypto.randomUUID(), item.id, envelope)).rejects.toBeInstanceOf(WrongSecretError)

    const rotated = await changeMasterPassword(state, 'master-password-1', 'master-password-2', userId)
    const rotatedState = { ...state, ...rotated }
    await expect(unlockWithPassword(rotatedState, 'master-password-1', userId)).rejects.toBeInstanceOf(WrongSecretError)
    const k2 = await unlockWithPassword(rotatedState, 'master-password-2', userId)
    expect((await decryptItem(k2, userId, item.id, envelope)).password).toBe('s3cr3t!')

    const recovered = await recoverVault(rotatedState, recoveryKey.toLowerCase(), 'master-password-3', userId)
    expect((await decryptItem(recovered.vaultKey, userId, item.id, envelope)).title).toBe('Banco')
    await expect(recoverVault(rotatedState, 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA', 'x-password-4', userId)).rejects.toBeInstanceOf(WrongSecretError)
  }, 60_000)

  it('round-trips recovery keys and tolerates look-alike characters', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(20))
    const formatted = formatRecoveryKey(bytes)
    expect(parseRecoveryKey(formatted)).toEqual(bytes)
    expect(parseRecoveryKey(formatted.replace(/0/g, 'O').replace(/-/g, ' '))).toEqual(bytes)
    expect(parseRecoveryKey('too-short')).toBeNull()
  })

  it('generates unbiased passwords with every selected character class', () => {
    const opts = { length: 24, lower: true, upper: true, digits: true, symbols: true, avoidAmbiguous: true }
    for (let i = 0; i < 200; i++) {
      const pwd = generatePassword(opts)
      expect(pwd).toHaveLength(24)
      expect(pwd).toMatch(/[a-z]/)
      expect(pwd).toMatch(/[A-Z]/)
      expect(pwd).toMatch(/[0-9]/)
      expect(pwd).toMatch(/[^a-zA-Z0-9]/)
      expect(pwd).not.toMatch(/[Il1O0o]/)
    }
    expect(entropyBits(opts)).toBeGreaterThan(140)
    expect(generatePassword({ ...opts, lower: false, upper: false, digits: true, symbols: false, length: 6 })).toMatch(/^[2-9]{6}$/)
  })
})
