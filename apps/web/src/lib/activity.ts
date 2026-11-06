import type { ActivityDTO, RealtimeEvent } from '@orqevio/shared'

const VERBS: Record<string, string> = {
  'card.created': 'creó la tarjeta',
  'card.updated': 'editó la tarjeta',
  'card.moved': 'movió la tarjeta',
  'card.reordered': 'reordenó la tarjeta',
  'card.archived': 'archivó la tarjeta',
  'card.restored': 'restauró la tarjeta',
  'card.deleted': 'eliminó la tarjeta',
  'card.checklist': 'actualizó la checklist de',
  'card.linked': 'vinculó un documento a',
  'card.unlinked': 'desvinculó un documento de',
  'column.created': 'creó la columna',
  'column.updated': 'renombró la columna',
  'column.moved': 'reordenó la columna',
  'column.deleted': 'eliminó la columna',
  'board.created': 'creó el tablero',
  'board.updated': 'renombró el tablero',
  'board.deleted': 'eliminó el tablero',
  'page.created': 'creó la página',
  'page.updated': 'editó la página',
  'page.moved': 'movió la página',
  'page.deleted': 'eliminó la página',
  'project.created': 'creó el proyecto',
  'project.updated': 'actualizó el proyecto',
  'project.deleted': 'eliminó el proyecto',
  'label.created': 'creó una etiqueta',
  'label.updated': 'editó una etiqueta',
  'label.deleted': 'eliminó una etiqueta',
}

export function activityVerb(action: string) {
  return VERBS[action] ?? 'actualizó'
}

export function activityDetail(a: Pick<ActivityDTO, 'action' | 'meta'>): string | null {
  const m = a.meta ?? {}
  if (a.action === 'card.moved' && m.to) return m.from ? `${m.from} → ${m.to}` : `a ${m.to}`
  if (a.action === 'card.created' && m.column) return `en ${m.column}`
  if (a.action === 'card.linked' && m.page) return `«${m.page}»`
  return null
}

export function eventSentence(e: RealtimeEvent) {
  const verb = activityVerb(e.action)
  return e.summary ? `${verb} «${e.summary}»` : verb
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
