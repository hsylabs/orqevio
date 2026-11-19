import type { RestoredDTO, TrashConflictDTO, TrashKind, TrashPlaceKind, TrashPlanDTO, TrashPlanNodeDTO, TrashRelationDTO } from '@orqevio/shared'
import { ChevronRight } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Checkbox } from '../../components/ui/Checkbox'
import { Dialog } from '../../components/ui/Dialog'
import { errorMessage } from '../../lib/api'
import { cn } from '../../lib/cn'
import { formatList } from '../../lib/format'
import { useBoard, useCard, useOverview, useSearch } from '../../lib/queries'
import { type RestoreRequest, planRestore, restoreItem } from '../../lib/trash'
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
      if (isPlain(plan)) return done(await restoreItem(workspaceId, { key }), plan.node.title)
      // Proposed to begin with: a new name for each one taken, and the other ends of its relations.
      const names: Record<string, string> = {}
      for (const c of plan.conflicts) if (c.taken && !c.kept) names[c.key] = suggestName(c, t('restoreDialog.suggested', { name: '{{name}}' }))
      const include = plan.relations.filter((r) => r.state === 'trash' && r.canInclude && r.key).map((r) => r.key!)
      const request: RestoreRequest = { key, ...(Object.keys(names).length && { names }), ...(include.length && { include }) }
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

/** "Tareas (restaurado)", within the length its kind takes, before a file's extension. */
function suggestName(conflict: TrashConflictDTO, pattern: string) {
  const max = NAME_MAX[conflict.kind] ?? 300
  const ext = conflict.kind === 'attachment' ? (/\.[^.\s]{1,16}$/.exec(conflict.original)?.[0] ?? '') : ''
  const base = ext ? conflict.original.slice(0, -ext.length) : conflict.original
  const room = max - (pattern.length - '{{name}}'.length) - ext.length
  return pattern.replace('{{name}}', base.slice(0, Math.max(1, room)).trimEnd()) + ext
}

type Where = 'original' | 'recreate' | 'other'

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
  const [plan, setPlan] = useState(initial.plan)
  const [request, setRequest] = useState(initial.request)
  const [busy, setBusy] = useState(false)
  const [planning, setPlanning] = useState(false)
  const latest = useRef(0)
  const first = useRef(true)

  // Every change is planned again, the last one winning; typing a name waits for a pause.
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const n = ++latest.current
    setPlanning(true)
    const timer = setTimeout(() => {
      planRestore(workspaceId, request)
        .then((fresh) => n === latest.current && setPlan(fresh))
        .catch((error) => n === latest.current && toast.error(errorMessage(error)))
        .finally(() => n === latest.current && setPlanning(false))
    }, 250)
    return () => clearTimeout(timer)
  }, [workspaceId, request])

  // A name found taken later (somewhere else chosen, say) gets a new one proposed too.
  useEffect(() => {
    const proposed: Record<string, string> = {}
    for (const c of plan.conflicts) {
      if (c.taken && !c.kept && request.names?.[c.key] === undefined && !(request.keepNames ?? []).includes(c.key)) proposed[c.key] = suggestName(c, t('restoreDialog.suggested', { name: '{{name}}' }))
    }
    if (Object.keys(proposed).length) setRequest((r) => ({ ...r, names: { ...r.names, ...proposed } }))
  }, [plan, request.names, request.keepNames, t])

  const name = plan.node.title || t('common:untitled')
  const where = plan.where
  // What the person picked; "somewhere else" asks nothing of the server until a place is chosen.
  const [choice, setChoice] = useState<Where | null>(initial.plan.where.to)
  const to: Where | null = choice ?? where.to
  const otherParent = request.to?.kind === 'other' ? request.to.parent : null
  const waitingPlace = to === 'other' && !otherParent
  const nameFor = (key: string) => request.names?.[key]
  const emptyName = Object.values(request.names ?? {}).some((v) => !v.trim())

  async function confirm() {
    setBusy(true)
    try {
      onDone(await restoreItem(workspaceId, request), plan.node.title)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const set = (patch: Partial<RestoreRequest>) => setRequest((r) => ({ ...r, ...patch }))
  const blocked = where.place !== 'original' && !where.canRecreate && where.choose.length === 0

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onCancel()}
      title={t('restoreDialog.title', { name })}
      width="max-w-[560px]"
      footer={
        <>
          {to && where.location && !blocked && !waitingPlace && <p className="mr-auto min-w-0 truncate text-[12.5px] text-ink-3">{t('restoreDialog.goesTo', { place: where.location })}</p>}
          <Button variant="ghost" onClick={onCancel}>
            {t('common:actions.cancel')}
          </Button>
          <Button variant="primary" loading={busy} disabled={!plan.ready || planning || emptyName || blocked || waitingPlace} onClick={() => void confirm()}>
            {t('restoreDialog.confirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6 text-[13.5px]">
        {plan.nodes.length > 1 && (
          <Section title={t('restoreDialog.what')} hint={t('restoreDialog.whatHint')}>
            <Tree nodes={plan.nodes} exclude={request.exclude ?? []} onChange={(exclude) => set({ exclude })} />
          </Section>
        )}

        <Section title={t('restoreDialog.where')}>
          {where.place === 'original' ? (
            <p className="text-ink-2">{where.location ? t('restoreDialog.backTo', { place: where.location }) : t('restoreDialog.backToTop')}</p>
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
                  {where.create.length > 0
                    ? t('restoreDialog.recreateCreate', { what: formatList(where.create.map((c) => t(`kindA.${c.kind}`, { name: c.title }))) })
                    : t('restoreDialog.recreatePath', { list: formatList(where.path.map((p) => t(`kindNamed.${p.kind}`, { name: p.title || t('common:untitled') }))) })}
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
    </Dialog>
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
      {q.trim().length >= 2 && (
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
