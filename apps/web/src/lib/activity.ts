import type { ActivityDTO, RealtimeEvent } from '@orqevio/shared'
import { t } from 'i18next'

const ACTIONS = {
  card: ['created', 'updated', 'moved', 'reordered', 'archived', 'restored', 'deleted', 'checklist', 'linked', 'unlinked'],
  column: ['created', 'updated', 'moved', 'deleted'],
  board: ['created', 'updated', 'deleted'],
  page: ['created', 'updated', 'moved', 'deleted'],
  project: ['created', 'updated', 'deleted'],
  label: ['created', 'updated', 'deleted'],
} as const

type Known = { [E in keyof typeof ACTIONS]: `actions.${E}.${(typeof ACTIONS)[E][number]}` }[keyof typeof ACTIONS]
type AboutThisCard = `actions.card.${(typeof ACTIONS)['card'][number]}_self`

/**
 * The catalog key of a whole sentence for an activity entry, with <actor> and
 * <target> tags, so each language can put the words in its own order. On the
 * card itself (`self`), card entries read "created this card".
 */
export function activityKey(action: string, self = false): Known | AboutThisCard | 'actions.other' {
  const [entity, verb] = action.split('.') as [string, string]
  const verbs = (ACTIONS as Record<string, readonly string[]>)[entity]
  if (!verbs?.includes(verb)) return 'actions.other'
  return self && entity === 'card' ? (`actions.${action}_self` as AboutThisCard) : (`actions.${action}` as Known)
}

/** What an entry is about: its title, or a placeholder for an untitled page. */
export function activityTarget(a: { entityType: string; summary: string }) {
  return a.summary || (a.entityType === 'page' ? t('common:untitled') : '')
}

export function activityDetail(a: Pick<ActivityDTO, 'action' | 'meta'>): string | null {
  const m = a.meta ?? {}
  if (a.action === 'card.moved' && m.to) return m.from ? t('activity:detail.movedFromTo', { from: m.from, to: m.to }) : t('activity:detail.movedTo', { to: m.to })
  if (a.action === 'card.created' && m.column) return t('activity:detail.createdIn', { column: m.column })
  if (a.action === 'card.linked' && 'page' in m) return t('activity:detail.linkedPage', { page: m.page || t('common:untitled') })
  return null
}

/** The sentence for a live event, as plain text (for notifications). */
export function eventSentence(e: RealtimeEvent) {
  const entityType = e.action.split('.')[0] ?? ''
  const sentence = t(activityKey(e.action), { ns: 'activity', actor: e.actor.name, target: activityTarget({ entityType, summary: e.summary ?? '' }) })
  return sentence.replace(/<\/?(?:actor|target)>/g, '')
}

/** Where an activity entry leads in the app. */
export function activityHref(workspaceId: string, a: Pick<ActivityDTO, 'entityType' | 'entityId' | 'action'>) {
  if (a.action.endsWith('.deleted')) return null
  if (a.entityType === 'card') return `/card/${a.entityId}`
  if (a.entityType === 'page') return `/w/${workspaceId}/d/${a.entityId}`
  if (a.entityType === 'board') return `/w/${workspaceId}/b/${a.entityId}`
  if (a.entityType === 'project') return `/w/${workspaceId}/p/${a.entityId}`
  return null
}
