import { z } from 'zod'
import { PALETTE } from './colors'
import { SCOPES } from './scopes'

/** Input schemas shared by the REST API, the MCP tools and the web forms. */

const id = z.uuid()
const name = (max = 120) => z.string().trim().min(1, 'Required').max(max)
const color = z.enum(PALETTE)
const index = z.number().int().min(0).max(100_000)
const isoDate = z.iso.datetime({ offset: true })

export const MAX_MARKDOWN = 200_000

// ── Access & account ────────────────────────────────────────────
// A copy of Orqevio has a single owner: it is claimed once with the setup code
// chosen at install time, and then opened with the generated access key.
const secret = z.string().trim().min(1, 'Required').max(256)

export const claimInput = z.object({ setupCode: secret, name: name(80) })
export const unlockInput = z.object({ accessKey: secret })
export const recoverInput = z.object({ setupCode: secret })
export const rotateAccessKeyInput = z.object({ currentAccessKey: secret })
export const confirmAccessKeyInput = z.object({ accessKey: secret })
export const updateAccountInput = z.object({
  name: name(80).optional(),
  theme: z.enum(['system', 'light', 'dark']).optional(),
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
export const boardCreateInput = z.object({
  name: name(80),
  columns: z.array(name(60)).max(20).optional(),
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
  dueAt: isoDate.nullable().optional(),
  labelIds: z.array(id).max(20).optional(),
  index: index.optional(),
})
export const cardUpdateInput = z.object({
  title: name(300).optional(),
  description: z.string().max(MAX_MARKDOWN).optional(),
  dueAt: isoDate.nullable().optional(),
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

// ── Agent tokens ────────────────────────────────────────────────
export const tokenCreateInput = z.object({
  name: name(60),
  workspaceId: id,
  scopes: z.array(z.enum(SCOPES)).min(1, 'Select at least one permission'),
  expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365)]).nullable(),
})

// ── Vault (opaque, client-encrypted payloads) ───────────────────
const b64 = z.string().regex(/^[A-Za-z0-9+/=_-]+$/).max(4096)
export const kdfSchema = z.object({
  algorithm: z.literal('argon2id'),
  salt: b64,
  memoryKiB: z.number().int().min(19_456).max(1_048_576),
  iterations: z.number().int().min(2).max(20),
  parallelism: z.number().int().min(1).max(8),
})
export const envelopeSchema = z
  .string()
  .regex(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, 'Invalid envelope')
  .max(400_000)
export const vaultKeysInput = z.object({
  kdf: kdfSchema,
  wrappedKey: envelopeSchema,
  recoveryWrappedKey: envelopeSchema,
})
export const vaultItemInput = z.object({ data: envelopeSchema })
export const vaultSettingsInput = z.object({ autoLockMinutes: z.union([z.literal(1), z.literal(5), z.literal(15), z.literal(30), z.literal(60)]) })

export type ClaimInput = z.infer<typeof claimInput>
export type UnlockInput = z.infer<typeof unlockInput>
export type ProjectCreateInput = z.infer<typeof projectCreateInput>
export type CardCreateInput = z.infer<typeof cardCreateInput>
export type CardUpdateInput = z.infer<typeof cardUpdateInput>
export type PageCreateInput = z.infer<typeof pageCreateInput>
export type PageUpdateInput = z.infer<typeof pageUpdateInput>
export type TokenCreateInput = z.infer<typeof tokenCreateInput>
export type KdfParams = z.infer<typeof kdfSchema>
export type VaultKeysInput = z.infer<typeof vaultKeysInput>
