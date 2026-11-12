import { describe, expect, it } from 'vitest'
import { WrongSecretError, openExport, sealExport } from '../src/features/vault/crypto'
import { MAX_IMPORT_BYTES, parseCsv, readDecryptedExport, readImport, toBitwardenJson, withoutDuplicates } from '../src/features/vault/transfer'
import { ITEM_LIMITS, type VaultItem, emptyItem } from '../src/features/vault/types'
import { MAX_VAULT_ITEMS } from '@orqevio/shared'

function items(text: string) {
  const outcome = readImport(text)
  if (outcome.kind !== 'items') throw new Error(`expected items, got ${JSON.stringify(outcome)}`)
  return outcome
}
const fields = (i: VaultItem) => ({ type: i.type, title: i.title, url: i.url, username: i.username, password: i.password, notes: i.notes, totp: i.totp, favorite: i.favorite })

describe('CSV', () => {
  it('reads quoted fields with commas, quotes and line breaks, CRLF and a BOM', () => {
    expect(parseCsv('﻿a,b,c\r\n"1,5","dice ""hola""","línea 1\nlínea 2"\r\n\r\n')).toEqual([
      ['a', 'b', 'c'],
      ['1,5', 'dice "hola"', 'línea 1\nlínea 2'],
    ])
    expect(parseCsv('a,b\nx,')).toEqual([['a', 'b'], ['x', '']])
  })
})

describe('importing', () => {
  it('reads the CSV of Chrome and Edge', () => {
    const result = items('name,url,username,password,note\nGitHub,https://github.com/login,lucia,"p,a""ss",Cuenta personal\n')
    expect(result.source).toBe('Chrome o Edge')
    expect(result.items.map(fields)).toEqual([
      { type: 'login', title: 'GitHub', url: 'https://github.com/login', username: 'lucia', password: 'p,a"ss', notes: 'Cuenta personal', totp: '', favorite: false },
    ])
    // Older Chrome exports have no note column.
    expect(items('name,url,username,password\nBanco,banco.es,ana,1234\n').items[0]).toMatchObject({ title: 'Banco', notes: '' })
  })

  it('keeps spaces at the end of the last value of the file', () => {
    expect(items('name,url,username,password\nEjemplo,https://example.com,alicia,secreto  \r\n').items[0]!.password).toBe('secreto  ')
    expect(items('\n\nname,url,username,password\nEjemplo,example.com,alicia,  secreto  ').items[0]!.password).toBe('  secreto  ')
  })

  it('reads the CSV of Firefox, naming entries after their site and keeping their dates', () => {
    const result = items(
      '"url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"\n' +
        '"https://www.example.org","ana","s3creto",,"https://www.example.org","{1}","1700000000000","1700000500000","1700000900000"\n',
    )
    expect(result.source).toBe('Firefox')
    expect(result.items[0]).toMatchObject({ title: 'example.org', username: 'ana', password: 's3creto', createdAt: new Date(1700000000000).toISOString(), updatedAt: new Date(1700000900000).toISOString() })
  })

  it('reads the CSV of Safari, with its two-step verification codes', () => {
    const result = items('Title,URL,Username,Password,Notes,OTPAuth\nGitHub (lucia),https://github.com,lucia,pw,,otpauth://totp/GitHub:lucia?secret=JBSWY3DPEHPK3PXP\n')
    expect(result.source).toBe('Safari')
    expect(result.items[0]).toMatchObject({ title: 'GitHub (lucia)', totp: 'otpauth://totp/GitHub:lucia?secret=JBSWY3DPEHPK3PXP' })
  })

  it("reads Bitwarden's CSV, with secure notes and favorites", () => {
    const result = items(
      'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n' +
        'Social,1,login,Twitter,,,0,twitter.com,me@example.com,password123,JBSWY3DPEHPK3PXP\n' +
        ',,note,Códigos de respaldo,"1111\n2222",,0,,,,\n',
    )
    expect(result.source).toBe('Bitwarden (CSV)')
    expect(result.items.map(fields)).toEqual([
      { type: 'login', title: 'Twitter', url: 'twitter.com', username: 'me@example.com', password: 'password123', notes: '', totp: 'JBSWY3DPEHPK3PXP', favorite: true },
      { type: 'note', title: 'Códigos de respaldo', url: '', username: '', password: '', notes: '1111\n2222', totp: '', favorite: false },
    ])
  })

  it("reads Bitwarden's unencrypted JSON and counts what it cannot keep", () => {
    const json = {
      encrypted: false,
      folders: [],
      items: [
        { type: 1, name: 'Correo', notes: null, favorite: true, login: { uris: [{ match: null, uri: 'https://mail.example.com' }], username: 'ana', password: 'x', totp: null }, creationDate: '2025-01-02T03:04:05.000Z', revisionDate: '2025-06-01T00:00:00.000Z' },
        { type: 2, name: 'Wi-Fi', notes: 'clave: abc', favorite: false, secureNote: { type: 0 } },
        { type: 3, name: 'Visa', card: { number: '4111' } },
        { type: 4, name: 'DNI', identity: {} },
      ],
    }
    const result = items(JSON.stringify(json))
    expect(result.unsupported).toBe(2)
    expect(result.items.map(fields)).toEqual([
      { type: 'login', title: 'Correo', url: 'https://mail.example.com', username: 'ana', password: 'x', notes: '', totp: '', favorite: true },
      { type: 'note', title: 'Wi-Fi', url: '', username: '', password: '', notes: 'clave: abc', totp: '', favorite: false },
    ])
    expect(result.items[0]).toMatchObject({ createdAt: '2025-01-02T03:04:05.000Z', updatedAt: '2025-06-01T00:00:00.000Z' })
  })

  it('explains the files it cannot read', () => {
    expect(readImport('   ')).toEqual({ kind: 'problem', problem: 'empty' })
    expect(readImport('{"encrypted":true,"encKeyValidation_DO_NOT_EDIT":"2.x","items":[]}')).toEqual({ kind: 'problem', problem: 'bitwarden_encrypted' })
    expect(readImport('{"encrypted":true,"passwordProtected":true,"salt":"x","data":"y"}')).toEqual({ kind: 'problem', problem: 'bitwarden_encrypted' })
    expect(readImport('fecha,importe\n2025-01-01,10\n')).toEqual({ kind: 'problem', problem: 'unknown_format' })
    expect(readImport('{ no es json')).toEqual({ kind: 'problem', problem: 'unknown_format' })
    expect(readImport('name,url,username,password,note\n')).toEqual({ kind: 'problem', problem: 'no_items' })
  })

  it('skips exact copies of items the vault already has, and repeated rows', () => {
    const existing = { ...emptyItem('login'), title: 'GitHub', username: 'lucia', password: 'pw' }
    const incoming = items('name,url,username,password\nGitHub,,lucia,pw\nGitLab,,lucia,pw\nGitLab,,lucia,pw\n').items
    const { fresh, duplicates } = withoutDuplicates(incoming, [existing])
    expect(fresh.map((i) => i.title)).toEqual(['GitLab'])
    expect(duplicates).toBe(2)
  })
})

describe('exporting', () => {
  const vault: VaultItem[] = [
    { ...emptyItem('login'), title: 'GitHub', url: 'github.com', username: 'lucia', password: 'p,a"ss\nline', notes: 'n', totp: 'JBSWY3DPEHPK3PXP', favorite: true, createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-02-01T00:00:00.000Z' },
    { ...emptyItem('note'), title: 'Wi-Fi', notes: 'abc', createdAt: '2025-03-01T00:00:00.000Z', updatedAt: '2025-03-02T00:00:00.000Z' },
  ]
  const withDates = (i: VaultItem) => ({ ...fields(i), createdAt: i.createdAt, updatedAt: i.updatedAt })

  it("keeps every field through Bitwarden's JSON and back", () => {
    const back = items(JSON.stringify(toBitwardenJson(vault)))
    expect(back.items.map(withDates)).toEqual(vault.map(withDates))
  })

  it('can import the encrypted export of a full vault', async () => {
    const full: VaultItem = { ...emptyItem('login'), ...Object.fromEntries(Object.entries(ITEM_LIMITS).map(([field, max]) => [field, 'a'.repeat(max)])) }
    const size = (list: VaultItem[]) => JSON.stringify(toBitwardenJson(list), null, 2).length
    const perItem = size([full, full]) - size([full])
    const plaintext = size([full]) + perItem * (MAX_VAULT_ITEMS - 1)
    // An encrypted export is the plaintext in base64 (plus the GCM tag) and a small header.
    const encrypted = (bytes: number) => Math.ceil(((bytes + 16) * 4) / 3) + 1024
    const sample = JSON.stringify(toBitwardenJson([full]), null, 2)
    expect(JSON.stringify(await sealExport(sample, 'caballo correcto pila grapa', 1), null, 2).length).toBeLessThanOrEqual(encrypted(sample.length))
    expect(encrypted(plaintext)).toBeLessThan(MAX_IMPORT_BYTES)
  }, 30_000)

  it('encrypts an export that only the master password opens', async () => {
    const file = await sealExport(JSON.stringify(toBitwardenJson(vault)), 'caballo correcto pila grapa', vault.length)
    expect(file).toMatchObject({ format: 'orqevio-vault-export', version: 1, count: 2, kdf: { algorithm: 'argon2id' } })
    expect(JSON.stringify(file)).not.toContain('GitHub')
    const outcome = readImport(JSON.stringify(file))
    expect(outcome.kind).toBe('encrypted')
    await expect(openExport(file, 'otra frase')).rejects.toBeInstanceOf(WrongSecretError)
    const back = readDecryptedExport(await openExport(file, 'caballo correcto pila grapa'))
    expect(back?.items.map(withDates)).toEqual(vault.map(withDates))
  }, 30_000)
})
