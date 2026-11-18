import type { RawSql } from '../db/raw'

/**
 * What a restore must not take back to how it was, read from the copy as it is now and applied to
 * the rows the backup brings back, in the same transaction.
 *
 * Access goes only one way. An agent whose access was taken away after the backup was made, an
 * intruder's after recovering access "because someone else may have it" included, does not get it
 * back by restoring "yesterday's backup": that is the very case a restore is for. And a vault key
 * version is never handed out twice, so a tab that still holds a newer key cannot save items with it.
 */
export interface Kept {
  ownerId: string | null
  /** Agent accesses (OAuth grants included) and when each was revoked, if it was. */
  tokens: Map<string, number | null>
  /** OAuth tokens there are now, and when each refresh token was exchanged, if it was. */
  oauthTokens: Map<string, number | null>
  /** OAuth codes there are now, and whether each was exchanged. */
  oauthCodes: Map<string, boolean>
  /** Each person's vault: the key version it has, and the vault key it stands for (wrapped). */
  vaults: Map<string, { keyVersion: number; wrappedKey: string | null }>
}

const num = (value: unknown) => (value === null || value === undefined ? null : Number(value))
/** The first value of each row, as text: ids. */
const column = (sql: RawSql, query: string) => [...sql.rows(query)].map((row) => String(row[0]))
const readVaults = (sql: RawSql) =>
  [...sql.rows('SELECT user_id, key_version, wrapped_key FROM vaults')].map(([userId, keyVersion, wrappedKey]) => ({
    userId: String(userId),
    keyVersion: Number(keyVersion),
    wrappedKey: wrappedKey === null || wrappedKey === undefined ? null : String(wrappedKey),
  }))

export function readKept(sql: RawSql): Kept {
  const [instance] = [...sql.rows('SELECT owner_id FROM instance WHERE id = 1')]
  return {
    ownerId: instance ? String(instance[0]) : null,
    tokens: new Map([...sql.rows('SELECT id, revoked_at FROM api_tokens')].map(([id, revokedAt]) => [String(id), num(revokedAt)])),
    oauthTokens: new Map([...sql.rows('SELECT id, rotated_at FROM oauth_tokens')].map(([id, rotatedAt]) => [String(id), num(rotatedAt)])),
    oauthCodes: new Map([...sql.rows('SELECT id, used_at FROM oauth_codes')].map(([id, usedAt]) => [String(id), usedAt !== null && usedAt !== undefined])),
    vaults: new Map(readVaults(sql).map(({ userId, ...vault }) => [userId, vault])),
  }
}

const hasColumn = (sql: RawSql, table: string, column: string) => {
  const [row] = [...sql.rows("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", table)]
  return Boolean(row && new RegExp(`\\b${column}\\b`).test(String(row[0])))
}

/**
 * Applies `kept` to the restored rows. The agents' part applies only when the backup is of this
 * same copy: one made by another (an earlier install, another server) comes back as it was, since
 * nothing here says anything about its agents.
 */
export function applyKept(sql: RawSql, kept: Kept, restoredOwnerId: string, now = Date.now()) {
  if (kept.ownerId === restoredOwnerId) {
    // An access revoked now, or gone since (its workspace deleted), comes back revoked.
    for (const id of column(sql, 'SELECT id FROM api_tokens WHERE revoked_at IS NULL')) {
      const current = kept.tokens.get(id)
      if (current === undefined || current !== null) sql.run('UPDATE api_tokens SET revoked_at = ? WHERE id = ?', current ?? now, id)
    }
    // OAuth tokens: one deleted since (revoked, or past its time) stays deleted, and a refresh
    // token exchanged since cannot be exchanged again: presenting it ends the grant, as it does now.
    for (const id of column(sql, 'SELECT id FROM oauth_tokens WHERE rotated_at IS NULL')) {
      const current = kept.oauthTokens.get(id)
      if (current === undefined) sql.run('DELETE FROM oauth_tokens WHERE id = ?', id)
      else if (current !== null) sql.run('UPDATE oauth_tokens SET rotated_at = ? WHERE id = ?', current, id)
    }
    for (const id of column(sql, 'SELECT id FROM oauth_tokens WHERE rotated_at IS NOT NULL')) {
      if (!kept.oauthTokens.has(id)) sql.run('DELETE FROM oauth_tokens WHERE id = ?', id)
    }
    // An authorization code exchanged, or deleted, since cannot be exchanged again.
    for (const id of column(sql, 'SELECT id FROM oauth_codes WHERE used_at IS NULL')) {
      const used = kept.oauthCodes.get(id)
      if (used === undefined) sql.run('DELETE FROM oauth_codes WHERE id = ?', id)
      else if (used) sql.run('UPDATE oauth_codes SET used_at = ? WHERE id = ?', now, id)
    }
  }

  // A vault whose key is not the one it has now gets a version never used before: every tab that
  // holds the key of now, or of any version in between, locks and is refused when it saves.
  if (!hasColumn(sql, 'vaults', 'key_version')) return
  const itemsLabelled = hasColumn(sql, 'vault_items', 'key_version')
  for (const restored of readVaults(sql)) {
    const current = kept.vaults.get(restored.userId)
    if (!current || (current.keyVersion === restored.keyVersion && current.wrappedKey === restored.wrappedKey)) continue
    const next = Math.max(current.keyVersion, restored.keyVersion) + 1
    sql.run('UPDATE vaults SET key_version = ? WHERE user_id = ?', next, restored.userId)
    if (itemsLabelled) sql.run('UPDATE vault_items SET key_version = ? WHERE user_id = ? AND key_version = ?', next, restored.userId, restored.keyVersion)
  }
}
