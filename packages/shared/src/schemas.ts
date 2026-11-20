import { z } from 'zod'
import { PALETTE } from './colors'
import { LOCALES } from './locales'
import { SCOPES } from './scopes'

/** Input schemas shared by the REST API, the MCP tools and the web forms. */

const id = z.uuid()
/** A character that shows: not a space, a control or formatting character, or a blank filler. */
const VISIBLE = /[^\s\p{Cc}\p{Cf}\p{Z}\u115F\u1160\u3164\uFFA0\u2800]/u
/** A one-line name: control characters (line breaks, tabs) become spaces, and it must show something. */
const name = (max = 120) =>
  z
    .string()
    .overwrite((value) => value.replace(/\p{Cc}+/gu, ' '))
    .trim()
    .min(1, { message: 'Required', abort: true })
    .max(max)
    .refine((value) => VISIBLE.test(value), 'Required')
const color = z.enum(PALETTE)
const index = z.number().int().min(0).max(100_000)

/** Due dates are calendar days, stored at 12:00 UTC so that every time zone shows the same day. */
export const DUE_YEARS = { min: 1900, max: 2199 } as const
const DUE_FORMAT = /^(\d{4})-(\d{2})-(\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?)?$/i

/**
 * The calendar day a due date names, as stored: `YYYY-MM-DD`, or an ISO 8601 date-time whose day
 * is the one written in it, whatever its time and offset (`2026-11-17T23:30-05:00` is the 17th).
 * Null when it is neither, names no real day, or falls outside `DUE_YEARS`.
 */
export function dueDay(value: string): string | null {
  const match = DUE_FORMAT.exec(value.trim())
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (year < DUE_YEARS.min || year > DUE_YEARS.max) return null
  const date = new Date(Date.UTC(year, month - 1, day, 12))
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date.toISOString()
}

export const DUE_DATE_HINT = `a day as YYYY-MM-DD, or an ISO 8601 date-time, between ${DUE_YEARS.min} and ${DUE_YEARS.max}`

const dueAt = z.string().transform((value, ctx) => {
  const day = dueDay(value)
  if (day) return day
  ctx.addIssue({ code: 'custom', message: `Due dates are ${DUE_DATE_HINT}` })
  return z.NEVER
})

export const MAX_MARKDOWN = 200_000

// ── Access & account ────────────────────────────────────────────
// A copy of Orqevio has a single owner: it is claimed once with the setup code
// chosen at install time, and then opened with the generated access key.
const secret = z.string().trim().min(1, 'Required').max(256)

export const claimInput = z.object({ setupCode: secret, name: name(80), locale: z.enum(LOCALES).optional() })
export const unlockInput = z.object({ accessKey: secret })
/** Why access is recovered: a stolen key may have let someone connect an agent of their own. */
export const RECOVERY_REASONS = ['lost', 'compromised'] as const
export const recoverInput = z.object({ setupCode: secret, reason: z.enum(RECOVERY_REASONS) })
export const rotateAccessKeyInput = z.object({ currentAccessKey: secret })
export const confirmAccessKeyInput = z.object({ accessKey: secret })
/** Uninstalling asks each time whether the copy's backups go too (they are kept apart from its data). */
export const uninstallInput = z.object({ accessKey: secret, deleteBackups: z.boolean() })
/** The installer's one-time authorization to uninstall, set as a Worker secret on the copy. */
export const installerUninstallInput = z.object({ token: z.string().min(40).max(200), deleteBackups: z.boolean().default(false) })
/** Restoring a backup replaces everything: it is confirmed with the access key. */
export const restoreBackupInput = z.object({ accessKey: secret })
export const updateAccountInput = z.object({
  name: name(80).optional(),
  theme: z.enum(['system', 'light', 'dark']).optional(),
  locale: z.enum(LOCALES).optional(),
})

// ── Workspaces & projects ───────────────────────────────────────
export const workspaceInput = z.object({ name: name(60) })
export const projectCreateInput = z.object({
  name: name(80),
  color: color.default('cobalt'),
  description: z.string().trim().max(500).optional(),
})
export const projectUpdateInput = z.object({
  name: name(80).optional(),
  color: color.optional(),
  description: z.string().trim().max(500).optional(),
})

// ── Boards, columns, labels ─────────────────────────────────────
/** The most columns a board holds. */
export const MAX_COLUMNS = 20
export const boardCreateInput = z.object({
  name: name(80),
  columns: z.array(name(60)).max(MAX_COLUMNS).optional(),
})
export const boardUpdateInput = z.object({ name: name(80) })
export const columnCreateInput = z.object({ name: name(60), index: index.optional() })
export const columnUpdateInput = z.object({ name: name(60).optional(), index: index.optional() })
export const labelCreateInput = z.object({ name: z.string().trim().max(40).default(''), color })
export const labelUpdateInput = z.object({ name: z.string().trim().max(40).optional(), color: color.optional() })

// ── Cards & checklists ──────────────────────────────────────────
export const cardCreateInput = z.object({
  title: name(300),
  description: z.string().max(MAX_MARKDOWN).optional(),
  dueAt: dueAt.nullable().optional(),
  labelIds: z.array(id).max(20).optional(),
  index: index.optional(),
})
export const cardUpdateInput = z.object({
  title: name(300).optional(),
  description: z.string().max(MAX_MARKDOWN).optional(),
  /** Optional with `description`: the version it was edited from. Without it, the last write wins. */
  baseVersion: z.number().int().min(1).optional(),
  dueAt: dueAt.nullable().optional(),
  labelIds: z.array(id).max(20).optional(),
})
export const cardMoveInput = z.object({ columnId: id, index })
export const checklistCreateInput = z.object({ title: name(120).default('Checklist') })
export const checklistUpdateInput = z.object({ title: name(120) })
export const checklistItemCreateInput = z.object({ text: name(500) })
export const checklistItemUpdateInput = z.object({
  text: name(500).optional(),
  done: z.boolean().optional(),
  index: index.optional(),
})
export const linkPageInput = z.object({ pageId: id })

// ── Pages ───────────────────────────────────────────────────────
export const pageCreateInput = z.object({
  title: z.string().trim().max(200).default(''),
  icon: z.string().max(16).nullable().optional(),
  parentId: id.nullable().optional(),
  content: z.string().max(MAX_MARKDOWN).default(''),
})
export const pageUpdateInput = z.object({
  title: z.string().trim().max(200).optional(),
  icon: z.string().max(16).nullable().optional(),
  content: z.string().max(MAX_MARKDOWN).optional(),
  /** Required when `content` is sent: optimistic concurrency guard. */
  baseVersion: z.number().int().min(1).optional(),
})
export const pageMoveInput = z.object({ parentId: id.nullable(), index })
/** Where an attachment goes: a card or a page. */
export const attachmentMoveInput = z
  .object({ cardId: id.optional(), pageId: id.optional() })
  .refine((v) => (v.cardId === undefined) !== (v.pageId === undefined), { message: 'Send either cardId or pageId' })

// ── Agent tokens ────────────────────────────────────────────────
export const tokenCreateInput = z.object({
  name: name(60),
  workspaceId: id,
  scopes: z.array(z.enum(SCOPES)).min(1, 'Select at least one permission'),
  expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365)]).nullable(),
})
/** What a person can change in a token or an OAuth connection afterwards: whether it can delete and move. */
export const tokenUpdateInput = z.object({ organize: z.boolean() })

// ── Vault (opaque, client-encrypted payloads) ───────────────────
const b64 = z.string().regex(/^[A-Za-z0-9+/=_-]+$/).max(4096)
export const kdfSchema = z.object({
  algorithm: z.literal('argon2id'),
  salt: b64,
  memoryKiB: z.number().int().min(19_456).max(1_048_576),
  iterations: z.number().int().min(2).max(20),
  parallelism: z.number().int().min(1).max(8),
})
/** Items a vault can hold. */
export const MAX_VAULT_ITEMS = 5000
/** Longest encrypted envelope the server keeps: a vault item, once encrypted, must fit in it. */
export const MAX_ENVELOPE_LENGTH = 400_000
export const envelopeSchema = z
  .string()
  .regex(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, 'Invalid envelope')
  .max(MAX_ENVELOPE_LENGTH)
export const vaultKeysInput = z.object({
  kdf: kdfSchema,
  wrappedKey: envelopeSchema,
  recoveryWrappedKey: envelopeSchema,
})
/**
 * Which vault key a client holds: it goes up each time a vault is set up (again, after a reset).
 * The server takes items and new wrappings only for the vault key it has now.
 */
const keyVersion = z.number().int().min(0).max(2_147_483_647)
export const vaultRekeyInput = vaultKeysInput.extend({ keyVersion })
/**
 * `baseUpdatedAt`: the item's `updatedAt` as this tab has it, or null for a new item. The server
 * refuses the save when the item changed or went since (`vault_item_changed`), so a tab that shows
 * an older version can't overwrite a newer one, or bring back a deleted one. Left out, nothing is
 * checked (tabs opened before 1.2.1).
 */
export const vaultItemInput = z.object({ data: envelopeSchema, keyVersion, baseUpdatedAt: z.string().datetime().nullable().optional() })
export const vaultSettingsInput = z.object({ autoLockMinutes: z.union([z.literal(1), z.literal(5), z.literal(15), z.literal(30), z.literal(60)]) })

export type ClaimInput = z.infer<typeof claimInput>
export type UnlockInput = z.infer<typeof unlockInput>
export type ProjectCreateInput = z.infer<typeof projectCreateInput>
export type RecoveryReason = (typeof RECOVERY_REASONS)[number]
export type CardCreateInput = z.infer<typeof cardCreateInput>
export type CardUpdateInput = z.infer<typeof cardUpdateInput>
export type PageCreateInput = z.infer<typeof pageCreateInput>
export type PageUpdateInput = z.infer<typeof pageUpdateInput>
export type TokenCreateInput = z.infer<typeof tokenCreateInput>
export type KdfParams = z.infer<typeof kdfSchema>
export type VaultKeysInput = z.infer<typeof vaultKeysInput>

/** Parameters of an OAuth authorization request, as received on the consent page. */
export const oauthRequestInput = z.object({ params: z.record(z.string(), z.string().max(4000)) })
export const oauthDecisionInput = oauthRequestInput.extend({
  allow: z.boolean(),
  workspaceId: z.string().optional(),
  scopes: z.array(z.enum(SCOPES)).max(SCOPES.length).optional(),
  /** Revoke this application's earlier access to the workspace once the new one is created. */
  replace: z.boolean().optional(),
})

// ── Undo ─────────────────────────────────────────────────────────
/**
 * What to undo: some changes (`ids`), or everything their author did from one change on
 * (`since`). With `conflicts: 'ask'` nothing is done while any conflicts: the answer lists
 * them; `skip` leaves those out and `force` undoes them anyway. `dryRun` only plans.
 */
export const undoInput = z
  .object({
    ids: z.array(id).min(1).max(500).optional(),
    since: id.optional(),
    /** With `since`: only the changes older than this one, to go on after a batch that ended there. */
    until: id.optional(),
    conflicts: z.enum(['ask', 'skip', 'force']).default('ask'),
    /** Only say what would happen: nothing is undone. */
    dryRun: z.boolean().default(false),
  })
  .refine((v) => (v.ids === undefined) !== (v.since === undefined), { message: 'Send either ids or since' })
  .refine((v) => v.until === undefined || v.since !== undefined, { message: 'until goes with since' })

// ── Trash ────────────────────────────────────────────────────────
/** Something in the trash, by key: `kind:id`, or `link:<card id>:<page id>`. */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
export const TRASH_KEY = new RegExp(`^(?:(?:project|board|column|card|page|attachment|label|checklist|checklist_item):${UUID}|link:${UUID}:${UUID})$`, 'i')
export const trashKey = z.string().regex(TRASH_KEY, 'Not a trash key')
/**
 * Restoring something from the trash with everything below it but what is left out (`exclude`).
 * `to` says where: where it was (`original`), with its place brought back too (`recreate`), or
 * in another container (`other`). Names already used where things go back are changed
 * (`names`) or kept on purpose (`keepNames`). Other ends of its relations that are in the
 * trash come back too when in `include`. `dryRun` only plans.
 */
export const trashRestoreInput = z.object({
  key: trashKey,
  exclude: z.array(trashKey).max(10_000).default([]),
  to: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('original') }),
      z.object({ kind: z.literal('recreate') }),
      z.object({ kind: z.literal('other'), parent: z.object({ kind: z.enum(['project', 'board', 'column', 'card', 'page', 'checklist']), id }) }),
    ])
    .optional(),
  names: z.record(trashKey, name(300)).default({}),
  keepNames: z.array(trashKey).max(10_000).default([]),
  include: z.array(trashKey).max(1000).default([]),
  dryRun: z.boolean().default(false),
})
export type TrashRestoreInput = z.infer<typeof trashRestoreInput>
export const trashPurgeInput = z.object({ key: trashKey, dryRun: z.boolean().default(false) })
/** The most things restored or deleted for good in one request. */
export const MAX_TRASH_BATCH = 100
/**
 * Restoring several things at once, each as `trashRestoreInput` says, in the order given: each
 * is planned with what the ones before it brought back already there. `dryRun` only plans.
 */
export const trashRestoreManyInput = z.object({
  items: z.array(trashRestoreInput.omit({ dryRun: true })).min(1).max(MAX_TRASH_BATCH),
  dryRun: z.boolean().default(false),
})
export type TrashRestoreManyInput = z.infer<typeof trashRestoreManyInput>
/** Deleting several things for good, with everything below them. `dryRun` only counts. */
export const trashPurgeManyInput = z.object({ keys: z.array(trashKey).min(1).max(MAX_TRASH_BATCH), dryRun: z.boolean().default(false) })
