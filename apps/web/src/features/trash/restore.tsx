import {
  type RestoredDTO,
  type TrashConflictDTO,
  type TrashKind,
  type TrashNodeDTO,
  type TrashPlaceKind,
  type TrashPlanDTO,
  type TrashPlanManyDTO,
  type TrashPlanNodeDTO,
  type TrashRelationDTO,
  searchable,
} from '@orqevio/shared'
import { ChevronRight } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Checkbox } from '../../components/ui/Checkbox'
import { Dialog } from '../../components/ui/Dialog'
import { ApiError, errorMessage } from '../../lib/api'
import { cn } from '../../lib/cn'
import { formatList } from '../../lib/format'
import { useBoard, useCard, useOverview, useSearch } from '../../lib/queries'
import { type RestoreRequest, planRestore, planRestoreMany, restoreItem, restoreMany } from '../../lib/trash'
import { TrashIcon } from './icons'

/** The longest name each kind takes, as the server does. */
const NAME_MAX: Partial<Record<TrashKind, number>> = { project: 80, board: 80, column: 60, label: 40, card: 300, page: 200, attachment: 180 }

/** Nothing to decide: it goes back where it was, alone, with nothing of its relations left behind. */
const isPlain = (plan: TrashPlanDTO) => plan.ready && plan.nodes.length === 1 && plan.where.place === 'original' && plan.conflicts.length === 0 && plan.relations.length === 0

/**
 * Restoring from the trash, as the person sees it: straight back when there is nothing to
 * decide, and otherwise a dialog saying what comes back, where, with which names, and what
 * becomes of its relations. Returns how to start it and the dialog to render.
 */
export function useRestore(workspaceId: string, options: { onRestored?: (restored: RestoredDTO) => void } = {}) {
  const { t } = useTranslation(['trash', 'common'])
  const navigate = useNavigate()
  const [asking, setAsking] = useState<{ plan: TrashPlanDTO; request: RestoreRequest } | null>(null)
  const [starting, setStarting] = useState<string | null>(null)

  function done(restored: RestoredDTO, name: string) {
    // A link whose page is in the trash waits for it: nothing came back yet.
    if (restored.waitsFor !== undefined) {
      toast.message(t('linkWaits', { name: restored.waitsFor || t('common:untitled') }))
      return options.onRestored?.(restored)
    }
    const notes = [restored.location ? t('restoredAt', { place: restored.location }) : '', restored.left ? t('leftInTrash', { count: restored.left }) : ''].filter(Boolean)
    toast.success(t('restored', { name: name || t('common:untitled') }), {
      ...(notes.length && { description: notes.join(' ') }),
      ...(restored.path && { action: { label: t('open'), onClick: () => navigate(`/w/${workspaceId}/${restored.path}`) } }),
    })
    options.onRestored?.(restored)
  }

  async function start(key: string) {
    setStarting(key)
    try {
      const plan = await planRestore(workspaceId, { key })
      // Where it goes is always said: if that changed meanwhile, the server asks instead of deciding.
      const to = plan.where.to && plan.where.to !== 'other' ? { kind: plan.where.to } : undefined
      if (isPlain(plan)) {
        try {
          return done(await restoreItem(workspaceId, { key, to }), plan.node.title)
        } catch (error) {
          const changed = planOf(error)
          if (!changed) throw error
          return setAsking({ plan: changed, request: { key, to } })
        }
      }
      // Proposed to begin with: a new name for each one taken, and the other ends of its relations.
      const request = proposedRequest(plan, key, t('restoreDialog.suggested', { name: '{{name}}' }))
      setAsking({ plan: request.names || request.include ? await planRestore(workspaceId, request) : plan, request })
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setStarting(null)
    }
  }

  const dialog = asking && (
    <RestoreDialog
      workspaceId={workspaceId}
      initial={asking}
      onCancel={() => setAsking(null)}
      onDone={(restored, name) => {
        setAsking(null)
        done(restored, name)
      }}
    />
  )
  return { start, starting, dialog }
}

/** One of several things being restored together, as the person has it so far. */
interface ManyItem {
  node: TrashNodeDTO
  request: RestoreRequest
  /** Where they picked: "somewhere else" waits for a place before anything is asked of the server. */
  choice: Where | null
  /** Unticked, it stays in the trash. */
  on: boolean
  /** No longer in the trash (restored meanwhile, say): it can't come back from here. */
  gone: boolean
}

/**
 * Restoring several things from the trash at once: always a dialog, where each comes with its
 * destination in sight and what is to decide already decided as proposed (a new name, its place
 * made anew), so that one click brings everything back; opening one shows all of it to change.
 */
export function useRestoreMany(workspaceId: string, options: { onRestored?: (restored: RestoredDTO[]) => void } = {}) {
  const { t } = useTranslation(['trash', 'common'])
  const [asking, setAsking] = useState<{ items: ManyItem[]; planned: TrashPlanManyDTO } | null>(null)
  const [starting, setStarting] = useState(false)

  async function start(nodes: TrashNodeDTO[]) {
    setStarting(true)
    try {
      const pattern = t('restoreDialog.suggested', { name: '{{name}}' })
      const first = await planRestoreMany(workspaceId, nodes.map((n) => ({ key: n.key })))
      const byKey = new Map(first.plans.map((p) => [p.node.key, p]))
      // The other end of a relation is proposed once, and never one picked itself: it comes on its own line.
      const asked = new Set(nodes.map((n) => n.key))
      const items = nodes.map((node): ManyItem => {
        const plan = byKey.get(node.key)
        const request = plan ? proposedRequest(plan, node.key, pattern, asked) : { key: node.key }
        for (const key of request.include ?? []) asked.add(key)
        const gone = Boolean(first.missing?.includes(node.key))
        return { node, request, choice: plan?.where.to ?? null, on: !gone, gone }
      })
      const on = items.filter((i) => i.on)
      // All gone meanwhile: the dialog says so, and there is nothing to plan.
      setAsking({ items, planned: on.length ? await planRestoreMany(workspaceId, on.map((i) => i.request)) : { plans: [], ready: false } })
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setStarting(false)
    }
  }

  const dialog = asking && (
    <RestoreManyDialog
      workspaceId={workspaceId}
      initial={asking}
      onCancel={() => setAsking(null)}
      onDone={(restored) => {
        setAsking(null)
        // A link whose page stays in the trash waits for it: nothing of it came back yet.
        const back = restored.filter((r) => r.waitsFor === undefined).length
        const waiting = restored.length - back
        const note = waiting ? { description: t('many.waiting', { count: waiting }) } : undefined
        if (back) toast.success(t('many.restored', { count: back }), note)
        else toast.message(t('many.waiting', { count: waiting }))
        options.onRestored?.(restored)
      }}
    />
  )
  return { start, starting, dialog }
}

/** The plans of a refused restore of several things, when what was shown no longer holds. */
function plansOf(error: unknown): TrashPlanManyDTO | null {
  return error instanceof ApiError && error.code === 'restore_incomplete' && Array.isArray((error.details as TrashPlanManyDTO | undefined)?.plans) ? (error.details as TrashPlanManyDTO) : null
}

function RestoreManyDialog({
  workspaceId,
  initial,
  onCancel,
  onDone,
}: {
  workspaceId: string
  initial: { items: ManyItem[]; planned: TrashPlanManyDTO }
  onCancel: () => void
  onDone: (restored: RestoredDTO[]) => void
}) {
  const { t } = useTranslation(['trash', 'common'])
  const [items, setItems] = useState(initial.items)
  // The plans shown are those for `planned`: restoring is only possible while that is what would be sent.
  const [shown, setShown] = useState({ result: initial.planned, planned: initial.items })
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const latest = useRef(0)
  const stale = shown.planned !== items
  const active = items.filter((i) => i.on)
  const planFor = new Map(shown.result.plans.map((p) => [p.node.key, p]))
  const cameWith = shown.result.cameWith ?? {}
  const missing = new Set([...items.filter((i) => i.gone).map((i) => i.node.key), ...(shown.result.missing ?? [])])
  const titleOf = (key: string) => items.find((i) => i.node.key === key)?.node.title || t('common:untitled')

  // Every change is planned again, together, the last one winning; typing a name waits for a pause.
  useEffect(() => {
    if (!stale && attempt === 0) return
    const n = ++latest.current
    setFailed(false)
    const asked = items
    const on = asked.filter((i) => i.on)
    const timer = setTimeout(() => {
      if (on.length === 0) {
        setShown({ result: { plans: [], ready: false }, planned: asked })
        return setAttempt(0)
      }
      planRestoreMany(
        workspaceId,
        on.map((i) => i.request),
      )
        .then((fresh) => {
          if (n !== latest.current) return
          setShown({ result: fresh, planned: asked })
          setAttempt(0)
        })
        .catch(() => n === latest.current && setFailed(true))
    }, 250)
    return () => clearTimeout(timer)
  }, [workspaceId, items, stale, attempt])

  // As in one restore: what no longer applies is no longer asked for, and a name found taken gets a new one.
  useEffect(() => {
    if (stale) return
    const pattern = t('restoreDialog.suggested', { name: '{{name}}' })
    let changed = false
    const next = items.map((item) => {
      // No longer in the trash (restored meanwhile, say): it can't come back, and is left out for good.
      if (!item.gone && missing.has(item.node.key)) {
        changed = true
        return { ...item, on: false, gone: true }
      }
      const plan = planFor.get(item.node.key)
      if (!item.on || !plan) return item
      let request = item.request
      const still = stillIncluded(plan, request)
      if (still) request = { ...request, include: still }
      const proposed = proposedNames(plan, request, pattern)
      if (Object.keys(proposed).length) request = { ...request, names: { ...request.names, ...proposed } }
      if (request === item.request) return item
      changed = true
      return { ...item, request }
    })
    if (changed) setItems(next)
  })

  const update = (key: string, patch: (item: ManyItem) => ManyItem) => setItems((all) => all.map((i) => (i.node.key === key ? patch(i) : i)))
  // Unticked, it stays in the trash: no other one brings it back as the other end of a relation.
  const tick = (key: string, on: boolean) =>
    setItems((all) => all.map((i) => (i.node.key === key ? { ...i, on } : on || !i.request.include?.includes(key) ? i : { ...i, request: { ...i.request, include: i.request.include.filter((k) => k !== key) } })))
  const pending = active.filter((i) => {
    if (cameWith[i.node.key]) return false
    const plan = planFor.get(i.node.key)
    return !plan || undecided(plan, i.request, i.choice)
  })

  async function confirm() {
    setBusy(true)
    try {
      onDone(await restoreMany(workspaceId, active.map((i) => i.request)))
    } catch (error) {
      // Something changed meanwhile: the dialog shows how things stand now, to decide again.
      const changed = plansOf(error)
      if (changed) setShown({ result: changed, planned: items })
      else if (error instanceof ApiError && error.code === 'restore_changed') setAttempt((a) => a + 1)
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onCancel()}
      title={t('many.title', { count: items.length })}
      description={t('many.body')}
      width="max-w-[640px]"
      footer={
        <>
          {failed ? (
            <p className="mr-auto flex min-w-0 items-center gap-2 text-[12.5px] text-danger" role="alert">
              {t('restoreDialog.planFailed')}
              <Button size="xs" variant="ghost" onClick={() => setAttempt((a) => a + 1)}>
                {t('restoreDialog.retry')}
              </Button>
            </p>
          ) : (
            !stale && pending.length > 0 && <p className="mr-auto min-w-0 text-[12.5px] text-warn">{t('many.pending', { count: pending.length })}</p>
          )}
          <Button variant="ghost" onClick={onCancel}>
            {t('common:actions.cancel')}
          </Button>
          <Button variant="primary" loading={busy} disabled={stale || failed || active.length === 0 || pending.length > 0} onClick={() => void confirm()}>
            {t('many.confirm', { count: active.length })}
          </Button>
        </>
      }
    >
      <ul className="flex flex-col gap-1.5" aria-label={t('many.list')}>
        {items.map((item) => {
          const plan = planFor.get(item.node.key)
          const name = item.node.title || t('common:untitled')
          const expanded = open === item.node.key && item.on && plan !== undefined
          return (
            <li key={item.node.key} aria-label={name} className={cn('rounded-[12px] border border-line', expanded && 'border-line-strong')}>
              <div className="flex min-h-11 items-center gap-2.5 px-2.5 py-1.5">
                <Checkbox checked={item.on} disabled={missing.has(item.node.key)} onChange={(on) => tick(item.node.key, on)} label={t('many.include', { name })} size={16} />
                <span className="text-ink-3 [&_svg]:size-4">
                  <TrashIcon kind={item.node.kind} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn('truncate text-[13.5px] font-medium', !item.on && 'text-ink-3 line-through decoration-ink-4')}>{name}</p>
                  <ManySummary item={item} plan={plan} stale={stale} gone={missing.has(item.node.key)} comesWith={cameWith[item.node.key] ? titleOf(cameWith[item.node.key]!) : null} />
                </div>
                {item.on && plan && (
                  <Button size="xs" variant="ghost" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : item.node.key)} aria-label={t(expanded ? 'many.doneChanging' : 'many.change', { name })}>
                    {t(expanded ? 'many.doneChangingShort' : 'many.changeShort')}
                  </Button>
                )}
              </div>
              {expanded && (
                <div className="border-t border-line px-3.5 py-3">
                  <PlanEditor
                    workspaceId={workspaceId}
                    plan={plan!}
                    request={item.request}
                    onChange={(f) => update(item.node.key, (i) => ({ ...i, request: f(i.request) }))}
                    choice={item.choice}
                    onChoice={(choice) => update(item.node.key, (i) => ({ ...i, choice }))}
                  />
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </Dialog>
  )
}

/** Where one of several goes, and what was decided for it, in one line under its name. */
function ManySummary({ item, plan, stale, gone, comesWith }: { item: ManyItem; plan: TrashPlanDTO | undefined; stale: boolean; gone: boolean; comesWith: string | null }) {
  const { t } = useTranslation(['trash', 'common'])
  if (gone) return <p className="text-[12.5px] text-warn">{t('many.gone')}</p>
  if (!item.on) return <p className="text-[12.5px] text-ink-3">{t('many.stays')}</p>
  if (comesWith) return <p className="text-[12.5px] text-ink-3">{t('many.comesWith', { name: comesWith })}</p>
  if (!plan) return <p className="skeleton mt-1 h-3 w-40 rounded" />
  const where = plan.where
  const to = item.choice ?? where.to
  const blocked = where.place !== 'original' && !where.canRecreate && where.choose.length === 0
  const notes: { text: string; tone?: 'warn' | 'danger' }[] = []
  if (blocked) notes.push({ text: t('restoreDialog.nowhere'), tone: 'danger' })
  else if (waitsForPlace(to, item.request) || plan.missing.includes('place')) notes.push({ text: t('many.choosePlace'), tone: 'warn' })
  else if (to === 'recreate') notes.push({ text: t('many.recreate', { place: where.location || t('common:untitled') }) })
  else if (to === 'other') notes.push({ text: t('many.other', { place: where.location }) })
  else notes.push({ text: where.location ? t('many.original', { place: where.location }) : t('many.originalTop') })
  for (const limit of plan.limits) notes.push({ text: t('many.noRoom', { board: limit.board || t('common:untitled'), count: limit.count, max: limit.max }), tone: 'danger' })
  // A name found taken, and the new one proposed or written for it.
  const renamed = plan.conflicts.filter((c) => !(item.request.keepNames ?? []).includes(c.key) && item.request.names?.[c.key])
  if (renamed.length === 1) notes.push({ text: t('many.renamed', { name: item.request.names![renamed[0]!.key] }) })
  else if (renamed.length > 1) notes.push({ text: t('many.renamedMany', { count: renamed.length }) })
  const inside = plan.nodes.filter((n) => n.included).length - 1
  if (inside > 0) notes.push({ text: t('many.withInside', { count: inside }) })
  // What else comes back from the trash with it, and what of its relations can't come back.
  const brings = plan.relations.filter((r) => r.state === 'trash' && r.included).map((r) => t('many.quoted', { name: r.title || t('common:untitled') }))
  if (brings.length) notes.push({ text: t('many.alsoBrings', { list: formatList(brings) }) })
  const lost = plan.relations.filter((r) => r.state === 'gone' || r.state === 'other_board').reduce((sum, r) => sum + r.count, 0)
  if (lost) notes.push({ text: t('many.lost', { count: lost }), tone: 'warn' })
  return (
    <p className={cn('text-[12.5px] text-pretty text-ink-3', stale && 'opacity-60')}>
      {notes.map((n, i) => (
        <span key={n.text} className={cn(n.tone === 'warn' && 'text-warn', n.tone === 'danger' && 'text-danger')}>
          {i > 0 && ' · '}
          {n.text}
        </span>
      ))}
    </p>
  )
}

/** The plan a refused restore answers with, when what was shown no longer holds. */
function planOf(error: unknown): TrashPlanDTO | null {
  return error instanceof ApiError && error.code === 'restore_incomplete' ? (error.details as TrashPlanDTO) : null
}

/** "Tareas (restaurado)", within the length its kind takes, before a file's extension. */
function suggestName(conflict: TrashConflictDTO, pattern: string) {
  const max = NAME_MAX[conflict.kind] ?? 300
  const ext = conflict.kind === 'attachment' ? (/\.[^.\s]{1,16}$/.exec(conflict.original)?.[0] ?? '') : ''
  const base = ext ? conflict.original.slice(0, -ext.length) : conflict.original
  const room = max - (pattern.length - '{{name}}'.length) - ext.length
  return pattern.replace('{{name}}', base.slice(0, Math.max(1, room)).trimEnd()) + ext
}

type Where = 'original' | 'recreate' | 'other'

/** A new name proposed for each one found taken that has none yet and isn't kept on purpose. */
function proposedNames(plan: TrashPlanDTO, request: RestoreRequest, pattern: string) {
  const proposed: Record<string, string> = {}
  for (const c of plan.conflicts) {
    if (c.taken && !c.kept && request.names?.[c.key] === undefined && !(request.keepNames ?? []).includes(c.key)) proposed[c.key] = suggestName(c, pattern)
  }
  return proposed
}

/** What else comes back, as the plan still allows: one that no longer applies is no longer asked for. */
function stillIncluded(plan: TrashPlanDTO, request: RestoreRequest) {
  if (!request.include?.length) return null
  const included = new Set(plan.relations.filter((r) => r.included && r.key).map((r) => r.key!))
  const still = request.include.filter((key) => included.has(key))
  return still.length === request.include.length ? null : still
}

/**
 * The request a plan's first look proposes: where it says, a new name for each taken one, and the
 * other ends of its relations, but those in `skip` (asked for already, or picked themselves).
 */
function proposedRequest(plan: TrashPlanDTO, key: string, pattern: string, skip: ReadonlySet<string> = new Set()): RestoreRequest {
  const where = plan.where
  const to = where.to && where.to !== 'other' ? { kind: where.to } : undefined
  const names = proposedNames(plan, { key }, pattern)
  const include = plan.relations.filter((r) => r.state === 'trash' && r.canInclude && r.key && !skip.has(r.key)).map((r) => r.key!)
  return { key, ...(to && { to }), ...(Object.keys(names).length && { names }), ...(include.length && { include }) }
}

/** Somewhere else was picked, and no place yet: nothing is asked of the server until there is one. */
const waitsForPlace = (choice: Where | null, request: RestoreRequest) => choice === 'other' && request.to?.kind !== 'other'

/** Whether the person still has to say something before it can go: where, or a name. */
function undecided(plan: TrashPlanDTO, request: RestoreRequest, choice: Where | null) {
  const where = plan.where
  const blocked = where.place !== 'original' && !where.canRecreate && where.choose.length === 0
  const emptyName = Object.values(request.names ?? {}).some((v) => !v.trim())
  return !plan.ready || blocked || waitsForPlace(choice ?? where.to, request) || emptyName
}

function RestoreDialog({
  workspaceId,
  initial,
  onCancel,
  onDone,
}: {
  workspaceId: string
  initial: { plan: TrashPlanDTO; request: RestoreRequest }
  onCancel: () => void
  onDone: (restored: RestoredDTO, name: string) => void
}) {
  const { t } = useTranslation(['trash', 'common'])
  // What is shown is the plan for `planned`: restoring is only possible while that is what would be sent.
  const [shown, setShown] = useState({ plan: initial.plan, planned: initial.request })
  const plan = shown.plan
  const [request, setRequest] = useState(initial.request)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const latest = useRef(0)
  const stale = shown.planned !== request

  // Every change is planned again, the last one winning; typing a name waits for a pause.
  useEffect(() => {
    if (!stale && attempt === 0) return
    const n = ++latest.current
    setFailed(false)
    const timer = setTimeout(() => {
      planRestore(workspaceId, request)
        .then((fresh) => {
          if (n !== latest.current) return
          setShown({ plan: fresh, planned: request })
          setAttempt(0)
        })
        .catch(() => n === latest.current && setFailed(true))
    }, 250)
    return () => clearTimeout(timer)
  }, [workspaceId, request, stale, attempt])

  // What comes back from the rest of the trash besides follows the plan: one that no longer
  // applies (what had it was left out) is no longer asked for.
  useEffect(() => {
    if (stale) return
    const still = stillIncluded(plan, request)
    if (still) setRequest((r) => ({ ...r, include: still }))
  }, [plan, request, stale])

  // A name found taken later (somewhere else chosen, say) gets a new one proposed too.
  useEffect(() => {
    const proposed = proposedNames(plan, request, t('restoreDialog.suggested', { name: '{{name}}' }))
    if (Object.keys(proposed).length) setRequest((r) => ({ ...r, names: { ...r.names, ...proposed } }))
  }, [plan, request, t])

  const name = plan.node.title || t('common:untitled')
  const where = plan.where
  // What the person picked; "somewhere else" asks nothing of the server until a place is chosen.
  const [choice, setChoice] = useState<Where | null>(initial.plan.where.to)
  const blocked = where.place !== 'original' && !where.canRecreate && where.choose.length === 0
  const waitingPlace = waitsForPlace(choice ?? where.to, request)

  async function confirm() {
    setBusy(true)
    try {
      onDone(await restoreItem(workspaceId, request), plan.node.title)
    } catch (error) {
      // Something changed meanwhile: the dialog shows how things stand now, to decide again.
      const changed = planOf(error)
      if (changed) setShown({ plan: changed, planned: request })
      else if (error instanceof ApiError && error.code === 'restore_changed') setAttempt((a) => a + 1)
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onCancel()}
      title={t('restoreDialog.title', { name })}
      width="max-w-[560px]"
      footer={
        <>
          {failed ? (
            <p className="mr-auto flex min-w-0 items-center gap-2 text-[12.5px] text-danger" role="alert">
              {t('restoreDialog.planFailed')}
              <Button size="xs" variant="ghost" onClick={() => setAttempt((a) => a + 1)}>
                {t('restoreDialog.retry')}
              </Button>
            </p>
          ) : (
            where.location && !blocked && !waitingPlace && <p className="mr-auto min-w-0 truncate text-[12.5px] text-ink-3">{t('restoreDialog.goesTo', { place: where.location })}</p>
          )}
          <Button variant="ghost" onClick={onCancel}>
            {t('common:actions.cancel')}
          </Button>
          <Button variant="primary" loading={busy} disabled={stale || failed || undecided(plan, request, choice)} onClick={() => void confirm()}>
            {t('restoreDialog.confirm')}
          </Button>
        </>
      }
    >
      <PlanEditor workspaceId={workspaceId} plan={plan} request={request} onChange={setRequest} choice={choice} onChoice={setChoice} />
    </Dialog>
  )
}

/**
 * What restoring one thing asks, as it is planned: what comes back (a tree with boxes), where,
 * with which names, and what becomes of its relations. Changes go to `onChange` as a new request.
 */
function PlanEditor({
  workspaceId,
  plan,
  request,
  onChange,
  choice,
  onChoice: setChoice,
}: {
  workspaceId: string
  plan: TrashPlanDTO
  request: RestoreRequest
  onChange: (update: (r: RestoreRequest) => RestoreRequest) => void
  choice: Where | null
  onChoice: (choice: Where) => void
}) {
  const { t } = useTranslation(['trash', 'common'])
  const where = plan.where
  const to: Where | null = choice ?? where.to
  const otherParent = request.to?.kind === 'other' ? request.to.parent : null
  const nameFor = (key: string) => request.names?.[key]
  const set = (patch: Partial<RestoreRequest>) => onChange((r) => ({ ...r, ...patch }))
  const blocked = where.place !== 'original' && !where.canRecreate && where.choose.length === 0

  return (
    <>
      <div className="flex flex-col gap-6 text-[13.5px]">
        {plan.nodes.length > 1 && (
          <Section title={t('restoreDialog.what')} hint={t('restoreDialog.whatHint')}>
            <Tree nodes={plan.nodes} exclude={request.exclude ?? []} onChange={(exclude) => set({ exclude })} />
          </Section>
        )}

        <Section title={t('restoreDialog.where')}>
          {where.place === 'original' && where.choose.length === 0 ? (
            <p className="text-ink-2">{where.location ? t('restoreDialog.backTo', { place: where.location }) : t('restoreDialog.backToTop')}</p>
          ) : where.place === 'original' ? (
            // Where it was is there; somewhere else is offered all the same (a full board, say).
            <div className="flex flex-col gap-2" role="radiogroup" aria-label={t('restoreDialog.where')}>
              <Choice
                checked={to === 'original'}
                onSelect={() => {
                  setChoice('original')
                  set({ to: { kind: 'original' } })
                }}
                title={t('restoreDialog.whereWas')}
              >
                {where.location ? t('restoreDialog.backTo', { place: where.location }) : t('restoreDialog.backToTop')}
              </Choice>
              <Choice
                checked={to === 'other'}
                onSelect={() => {
                  setChoice('other')
                  set({ to: otherParent ? { kind: 'other', parent: otherParent } : undefined })
                }}
                title={t('restoreDialog.elsewhere')}
              >
                {to === 'other' ? (
                  <PlacePicker workspaceId={workspaceId} choose={where.choose} value={otherParent} onChange={(parent) => set({ to: parent ? { kind: 'other', parent } : undefined })} />
                ) : (
                  t('restoreDialog.elsewhereHint')
                )}
              </Choice>
            </div>
          ) : blocked ? (
            <p className="text-danger">{t('restoreDialog.nowhere')}</p>
          ) : (
            <div className="flex flex-col gap-2" role="radiogroup" aria-label={t('restoreDialog.where')}>
              <p className="text-ink-2">{t(where.place === 'trash' ? 'place.trash' : 'place.gone')}</p>
              {where.canRecreate && (
                <Choice
                  checked={to === 'recreate'}
                  onSelect={() => {
                    setChoice('recreate')
                    set({ to: { kind: 'recreate' } })
                  }}
                  title={t('restoreDialog.recreate')}
                >
                  {[
                    where.create.length > 0 ? t('restoreDialog.recreateCreate', { what: formatList(where.create.map((c) => t(`kindA.${c.kind}`, { name: c.title }))) }) : '',
                    where.path.length > 0 ? t('restoreDialog.recreatePath', { list: formatList(where.path.map((p) => t(`kindNamed.${p.kind}`, { name: p.title || t('common:untitled') }))) }) : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                </Choice>
              )}
              {where.choose.length > 0 && (
                <Choice
                  checked={to === 'other'}
                  onSelect={() => {
                    setChoice('other')
                    set({ to: otherParent ? { kind: 'other', parent: otherParent } : undefined })
                  }}
                  title={t('restoreDialog.elsewhere')}
                >
                  {to === 'other' || !where.canRecreate ? (
                    <PlacePicker
                      workspaceId={workspaceId}
                      choose={where.choose}
                      value={otherParent}
                      onChange={(parent) => set({ to: parent ? { kind: 'other', parent } : undefined })}
                    />
                  ) : (
                    t('restoreDialog.elsewhereHint')
                  )}
                </Choice>
              )}
            </div>
          )}
        </Section>

        {plan.limits.length > 0 && (
          <div role="alert" className="flex flex-col gap-1 rounded-[12px] border border-danger/30 bg-danger-soft px-3.5 py-3 text-[13px]">
            {plan.limits.map((limit) => (
              <p key={limit.board}>{t('restoreDialog.tooManyColumns', { board: limit.board || t('common:untitled'), count: limit.count, max: limit.max })}</p>
            ))}
            <p>{t(plan.nodes.filter((n) => n.kind === 'column').length > 1 ? 'restoreDialog.roomHintMany' : 'restoreDialog.roomHint')}</p>
          </div>
        )}

        {plan.conflicts.length > 0 && (
          <Section title={t('restoreDialog.names')}>
            <ul className="flex flex-col gap-3">
              {plan.conflicts.map((c) => (
                <NameRow
                  key={c.key}
                  conflict={c}
                  value={nameFor(c.key) ?? c.original}
                  kept={(request.keepNames ?? []).includes(c.key)}
                  onName={(value) => set({ names: { ...request.names, [c.key]: value } })}
                  onKeep={(keep) => {
                    const keepNames = new Set(request.keepNames ?? [])
                    const names = { ...request.names }
                    if (keep) {
                      keepNames.add(c.key)
                      delete names[c.key]
                    } else {
                      keepNames.delete(c.key)
                      names[c.key] = suggestName(c, t('restoreDialog.suggested', { name: '{{name}}' }))
                    }
                    set({ keepNames: [...keepNames], names })
                  }}
                />
              ))}
            </ul>
          </Section>
        )}

        {plan.relations.length > 0 && (
          <Section title={t('restoreDialog.relations')}>
            <ul className="flex flex-col gap-2.5">
              {plan.relations.map((r) => (
                <Relation
                  key={`${r.state}-${r.kind}-${r.key ?? r.title}`}
                  relation={r}
                  onInclude={(include) => {
                    const keys = new Set(request.include ?? [])
                    if (include) keys.add(r.key!)
                    else keys.delete(r.key!)
                    set({ include: [...keys] })
                  }}
                />
              ))}
            </ul>
          </Section>
        )}
      </div>
    </>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h3 className="text-[12px] font-semibold tracking-[0.04em] text-ink-3 uppercase">{title}</h3>
        {hint && <p className="mt-0.5 text-[12.5px] text-ink-3">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function Choice({ checked, onSelect, title, children }: { checked: boolean; onSelect: () => void; title: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-[12px] border px-3.5 py-3 transition-colors', checked ? 'border-accent bg-accent-soft' : 'border-line')}>
      <label className="flex cursor-pointer items-center gap-2.5 font-medium">
        <input type="radio" checked={checked} onChange={onSelect} className="size-4 accent-[var(--accent)]" />
        {title}
      </label>
      <div className="mt-1.5 pl-[26px] text-[13px] text-ink-2">{children}</div>
    </div>
  )
}

/** What comes back, as a tree with boxes: leaving something out leaves out what is below it. */
function Tree({ nodes, exclude, onChange }: { nodes: TrashPlanNodeDTO[]; exclude: string[]; onChange: (exclude: string[]) => void }) {
  const { t } = useTranslation(['trash', 'common'])
  const children = useMemo(() => {
    const map = new Map<string | null, TrashPlanNodeDTO[]>()
    for (const n of nodes) map.set(n.parentKey, [...(map.get(n.parentKey) ?? []), n])
    return map
  }, [nodes])
  const root = nodes[0]!
  const [open, setOpen] = useState(() => new Set([root.key]))
  const left = new Set(exclude)
  const toggle = (n: TrashPlanNodeDTO) => onChange(n.included ? [...left, n.key] : [...left].filter((k) => k !== n.key))

  const branch = (n: TrashPlanNodeDTO, depth: number, parentIncluded: boolean): ReactNode => {
    const below = children.get(n.key) ?? []
    const expanded = open.has(n.key)
    const label = n.title || t('common:untitled')
    return (
      <li key={n.key}>
        <div className="flex min-h-8 items-center gap-2 rounded-[8px] pr-2 hover:bg-hover" style={{ paddingLeft: depth * 18 }}>
          {below.length > 0 ? (
            <button
              type="button"
              className="grid size-6 place-items-center rounded-[6px] text-ink-3 hover:text-ink"
              aria-expanded={expanded}
              aria-label={t(expanded ? 'collapse' : 'expand', { name: label })}
              onClick={() => setOpen((s) => new Set(expanded ? [...s].filter((k) => k !== n.key) : [...s, n.key]))}
            >
              <ChevronRight className={cn('size-3.5 transition-transform', expanded && 'rotate-90')} />
            </button>
          ) : (
            <span className="size-6" />
          )}
          <Checkbox checked={n.included} disabled={n === root || !parentIncluded} onChange={() => toggle(n)} label={t('restoreDialog.include', { name: label })} size={16} />
          <span className="text-ink-3 [&_svg]:size-3.5">
            <TrashIcon kind={n.kind} />
          </span>
          <span className={cn('min-w-0 flex-1 truncate', !n.included && 'text-ink-3 line-through decoration-ink-4')}>{label}</span>
          {n.earlier && <span className="shrink-0 rounded-full bg-sunken px-2 py-0.5 text-[11px] text-ink-3">{t('earlier')}</span>}
        </div>
        {below.length > 0 && expanded && <ul>{below.map((c) => branch(c, depth + 1, parentIncluded && n.included))}</ul>}
      </li>
    )
  }
  return <ul className="max-h-[280px] overflow-y-auto rounded-[12px] border border-line p-1.5">{branch(root, 0, true)}</ul>
}

function NameRow({ conflict, value, kept, onName, onKeep }: { conflict: TrashConflictDTO; value: string; kept: boolean; onName: (value: string) => void; onKeep: (keep: boolean) => void }) {
  const { t } = useTranslation(['trash', 'common'])
  const what = t(`kindA.${conflict.kind}`, { name: conflict.original || t('common:untitled') })
  const max = NAME_MAX[conflict.kind] ?? 300
  return (
    <li className="flex flex-col gap-1.5">
      <p>{conflict.where ? t('restoreDialog.nameTaken', { what, where: conflict.where }) : t('restoreDialog.nameTakenTop', { what })}</p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          className="field h-9 min-w-[200px] flex-1"
          value={kept ? conflict.original : value}
          maxLength={max}
          disabled={kept}
          aria-label={t('restoreDialog.newName', { name: conflict.original })}
          aria-invalid={!kept && (!value.trim() || (conflict.taken && conflict.name === value)) ? true : undefined}
          onChange={(e) => onName(e.target.value)}
        />
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
          <Checkbox checked={kept} onChange={onKeep} label={t('restoreDialog.keepName')} size={16} />
          <span aria-hidden>{t('restoreDialog.keepName')}</span>
        </label>
      </div>
      {!kept && !value.trim() && <p className="text-[12.5px] text-danger">{t('restoreDialog.nameEmpty')}</p>}
      {/* Said of the name shown only: a new one is still being checked. */}
      {!kept && value.trim() && conflict.taken && conflict.name === value && <p className="text-[12.5px] text-danger">{t('restoreDialog.nameStillTaken')}</p>}
    </li>
  )
}

function Relation({ relation: r, onInclude }: { relation: TrashRelationDTO; onInclude: (include: boolean) => void }) {
  const { t } = useTranslation(['trash', 'common'])
  const what = t(`relationKind.${r.kind}`, { name: r.title || t('common:untitled') })
  const of = r.count > 1 ? t('restoreDialog.ofMany', { count: r.count }) : t('restoreDialog.ofOne', { name: r.first || t('common:untitled') })
  if (r.state === 'trash' && r.canInclude) {
    return (
      <li className="flex items-start gap-2.5">
        <Checkbox checked={r.included} onChange={onInclude} label={t('restoreDialog.bringToo', { what })} size={16} className="mt-0.5" />
        <p>
          <span className="font-medium">{what}</span> <span className="text-ink-3">{of}</span>
          <br />
          <span className="text-[12.5px] text-ink-3">{r.included ? t('restoreDialog.comesToo') : t('restoreDialog.waits')}</span>
        </p>
      </li>
    )
  }
  const text = r.state === 'trash' ? t('restoreDialog.staysWaiting', { what, of }) : r.state === 'gone' ? t(`restoreDialog.gone.${r.kind}`, { of }) : t('restoreDialog.otherBoard', { what, of })
  return <li className="text-ink-2">{text}</li>
}

/** A live container to put something in, by level: what `choose` allows. */
function PlacePicker({ workspaceId, choose, value, onChange }: { workspaceId: string; choose: TrashPlaceKind[]; value: { kind: string; id: string } | null; onChange: (value: { kind: TrashPlaceKind; id: string } | null) => void }) {
  const { t } = useTranslation(['trash', 'common'])
  const overview = useOverview(workspaceId)
  const projects = overview.data?.projects ?? []
  const [projectId, setProjectId] = useState<string>('')
  const [boardId, setBoardId] = useState<string>('')
  const [cardId, setCardId] = useState<string>('')
  const [mode, setMode] = useState<TrashPlaceKind>(choose.includes('card') ? 'card' : choose[0]!)
  const card = useCard(cardId || null)
  const project = projects.find((p) => p.id === projectId)
  const wants = (kind: TrashPlaceKind) => choose.includes(kind)

  const select = (label: string, current: string, options: { value: string; label: string }[], set: (v: string) => void, placeholder: string) => (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-medium text-ink-3">{label}</span>
      <select className="field h-9" value={current} onChange={(e) => set(e.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )

  // A page goes at the top of a project, or under a page of it: shown as the tree they make.
  const pageOptions = useMemo(() => {
    const pages = project?.pages ?? []
    const out: { value: string; label: string }[] = []
    const walk = (parentId: string | null, depth: number) => {
      for (const p of pages.filter((x) => x.parentId === parentId).sort((a, b) => (a.position < b.position ? -1 : 1))) {
        out.push({ value: p.id, label: `${'  '.repeat(depth)}${p.title || t('common:untitled')}` })
        if (depth < 20) walk(p.id, depth + 1)
      }
    }
    walk(null, 0)
    return out
  }, [project, t])

  const projectOptions = projects.map((p) => ({ value: p.id, label: p.name }))
  const pickProject = (id: string) => {
    setProjectId(id)
    setBoardId('')
    if (wants('project') && (mode === 'project' || mode === 'page')) onChange(id ? { kind: 'project', id } : null)
    else onChange(null)
  }

  if (mode === 'card' || mode === 'checklist' || (wants('checklist') && !wants('card'))) {
    return (
      <div className="flex flex-col gap-2.5">
        {wants('card') && wants('page') && <ModeSwitch mode={mode} setMode={(m) => (setMode(m), onChange(null))} />}
        <CardSearch
          workspaceId={workspaceId}
          value={cardId}
          onChange={(id) => {
            setCardId(id)
            onChange(id && wants('card') ? { kind: 'card', id } : null)
          }}
        />
        {wants('checklist') &&
          cardId &&
          select(
            t('picker.checklist'),
            value?.kind === 'checklist' ? value.id : '',
            (card.data?.checklists ?? []).map((c) => ({ value: c.id, label: c.title })),
            (id) => onChange(id ? { kind: 'checklist', id } : null),
            t('picker.chooseChecklist'),
          )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      {wants('card') && wants('page') && <ModeSwitch mode={mode} setMode={(m) => (setMode(m), onChange(null))} />}
      {select(t('picker.project'), projectId, projectOptions, pickProject, t('picker.chooseProject'))}
      {project && (wants('board') || wants('column')) &&
        select(
          t('picker.board'),
          boardId,
          project.boards.map((b) => ({ value: b.id, label: b.name })),
          (id) => {
            setBoardId(id)
            onChange(id && wants('board') ? { kind: 'board', id } : null)
          },
          t('picker.chooseBoard'),
        )}
      {boardId && wants('column') && (
        <ColumnSelect boardId={boardId} render={(columns) => select(t('picker.column'), value?.kind === 'column' ? value.id : '', columns, (id) => onChange(id ? { kind: 'column', id } : null), t('picker.chooseColumn'))} />
      )}
      {project &&
        wants('page') &&
        select(
          t(wants('project') ? 'picker.parent' : 'picker.page'),
          value?.kind === 'page' ? value.id : '',
          pageOptions,
          (id) => onChange(id ? { kind: 'page', id } : wants('project') ? { kind: 'project', id: project.id } : null),
          t(wants('project') ? 'picker.atTop' : 'picker.choosePage'),
        )}
    </div>
  )
}

/** The columns of a board, read once it is chosen. */
function ColumnSelect({ boardId, render }: { boardId: string; render: (columns: { value: string; label: string }[]) => ReactNode }) {
  const board = useBoard(boardId)
  return render((board.data?.columns ?? []).map((c) => ({ value: c.id, label: c.name })))
}

function ModeSwitch({ mode, setMode }: { mode: TrashPlaceKind; setMode: (mode: TrashPlaceKind) => void }) {
  const { t } = useTranslation('trash')
  return (
    <div className="flex gap-1.5" role="radiogroup" aria-label={t('picker.in')}>
      {(['card', 'page'] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          onClick={() => setMode(m)}
          className={cn('rounded-[8px] px-2.5 py-1 text-[12.5px] font-medium', mode === m ? 'bg-surface text-ink shadow-sm ring-1 ring-line' : 'text-ink-3 hover:text-ink')}
        >
          {t(`picker.${m}`)}
        </button>
      ))}
    </div>
  )
}

function CardSearch({ workspaceId, value, onChange }: { workspaceId: string; value: string; onChange: (id: string) => void }) {
  const { t } = useTranslation(['trash', 'common'])
  const [q, setQ] = useState('')
  const found = useSearch(workspaceId, q, 'card')
  const results = found.data ?? []
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-medium text-ink-3">{t('picker.card')}</span>
        <input className="field h-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('picker.searchCard')} />
      </label>
      {searchable(q) && (
        <ul className="max-h-[160px] overflow-y-auto rounded-[10px] border border-line p-1" aria-label={t('picker.results')}>
          {results.length === 0 && !found.isFetching && <li className="px-2 py-1.5 text-ink-3">{t('picker.noCards')}</li>}
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                aria-pressed={value === r.id}
                onClick={() => onChange(value === r.id ? '' : r.id)}
                className={cn('flex w-full flex-col items-start rounded-[8px] px-2 py-1.5 text-left hover:bg-hover', value === r.id && 'bg-accent-soft')}
              >
                <span className="truncate font-medium">{r.title || t('common:untitled')}</span>
                <span className="truncate text-[12px] text-ink-3">{[r.projectName, r.boardName, r.columnName].filter(Boolean).join(' › ')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
