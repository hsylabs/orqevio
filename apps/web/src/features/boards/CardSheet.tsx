import type { ActorRef, BoardDTO, CardDetailDTO, CardSummaryDTO, TrashedDTO } from '@orqevio/shared'
import type { Editor as TiptapEditor } from '@tiptap/core'
import { Archive, ArchiveX, ArrowDown, ArrowUp, Bot, Calendar, ChevronDown, Columns3, Ellipsis, History, ListChecks, MessageSquare, Tag, Trash, TriangleAlert, X } from 'lucide-react'
import { type ReactNode, useEffect, useReducer, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { ActivityList } from '../../components/ActivityList'
import { fitTitle, usePhrasedField } from '../../components/Phrases'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { useConfirm } from '../../components/ui/confirm'
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from '../../components/ui/Menu'
import { HistoryDialog } from '../history/HistoryDialog'
import { Sheet, SheetClose } from '../../components/ui/Sheet'
import { ApiError, del, errorMessage, get, patch, post } from '../../lib/api'
import { cn } from '../../lib/cn'
import { relativeTime } from '../../lib/format'
import { keys, queryClient, useCard } from '../../lib/queries'
import { onCardEvent, useAgentHighlight } from '../../lib/realtime'
import { Editor } from '../docs/editor/Editor'
import { showTogglesAsBefore, togglesShown } from '../docs/editor/toggle'
import { useWorkspace } from '../shell/workspace'
import { Attachments } from './Attachments'
import { DueChip } from './CardItem'
import { Checklists } from './Checklists'
import { Comments } from './Comments'
import { DuePicker } from './DuePicker'
import { LabelPicker } from './LabelPicker'
import { LinkedPages } from './LinkedPages'
import { toastTrashed, trashNote } from '../../lib/trash'
import { isConverting } from '../../lib/ime'

/** Cards this tab is deleting: their sheet just closes, without saying they are gone. */
const deletingHere = new Set<string>()
/** When each card was deleted elsewhere. Live updates don't fetch a deleted card: its sheet says it is gone instead. */
const deletedAt = new Map<string, number>()
onCardEvent((e) => {
  if (!e.cardId) return
  if (e.action === 'card.deleted' && !deletingHere.has(e.cardId)) deletedAt.set(e.cardId, Date.now())
  // Back from the trash: deleting it again later, here or elsewhere, counts as usual.
  if (e.action === 'trash.restored') deletingHere.delete(e.cardId)
})

/** The card title's type: the field and, in Japanese where only BudouX tells phrases apart, the title drawn over it. */
const TITLE_TYPE = 'font-display text-[26px] leading-[1.18] font-medium tracking-[-0.02em]'

export function CardSheet({ cardId, board, onClose }: { cardId: string | null; board: BoardDTO; onClose: () => void }) {
  const { t } = useTranslation(['boards', 'common'])
  const card = useCard(cardId)
  const open = Boolean(cardId)
  const [, update] = useReducer((n: number) => n + 1, 0)
  useEffect(() => onCardEvent((e) => e.cardId === cardId && update()), [cardId])
  // Gone once deleted elsewhere, until the card is fetched again since then (restoring it refetches it).
  const deleted = cardId ? deletedAt.get(cardId) : undefined
  const gone = card.isError || (deleted !== undefined && card.dataUpdatedAt <= deleted)
  // While the sheet slides away it keeps showing the card it had, also one just deleted.
  const last = useRef(card.data)
  if (card.data) last.current = card.data
  const data = open ? card.data : last.current
  // Moved to another board while open (by an agent, say): follow it there, where its columns and labels are.
  const navigate = useNavigate()
  const { workspaceId } = useWorkspace()
  const elsewhere = open && card.data && card.data.boardId !== board.id ? card.data.boardId : null
  useEffect(() => {
    if (elsewhere && cardId) navigate(`/w/${workspaceId}/b/${elsewhere}?card=${cardId}`, { replace: true })
  }, [elsewhere, cardId, workspaceId, navigate])
  // Its column deleted elsewhere took it to the trash too: asked for again, it is gone. And when the
  // column is back from the trash, so is the card: asked for again, it is there.
  const columnGone = open && card.data?.boardId === board.id && !board.columns.some((c) => c.id === card.data!.columnId)
  const { refetch, isError } = card
  useEffect(() => {
    if (columnGone || isError) void refetch()
    // Only when the column goes or comes back: a failed fetch is not retried on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnGone, refetch])
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title={data?.title ?? t('sheet.fallbackTitle')} label={t('sheet.label')}>
      {elsewhere ? null : data && !(open && gone) ? (
        <CardBody key={data.id} card={data} board={board} onClose={onClose} />
      ) : gone ? (
        <div className="grid flex-1 place-items-center p-8 text-center text-ink-2">
          <div>
            <p className="font-display text-[20px]">{t('sheet.gone')}</p>
            <Button className="mt-4" onClick={onClose}>
              {t('common:actions.close')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="p-8" aria-busy="true">
          <div className="skeleton h-8 w-2/3" />
          <div className="skeleton mt-6 h-4 w-1/2" />
          <div className="skeleton mt-3 h-24 w-full" />
        </div>
      )}
    </Sheet>
  )
}

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="grid min-h-9 grid-cols-[112px_1fr] items-center gap-3">
      <span className="flex items-center gap-2 text-[12.5px] text-ink-3 [&_svg]:size-[15px]">
        {icon}
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function Section({ title, icon, children, action }: { title: string; icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    // Wider on the left: the room the description's block handle takes (BlockControls), a finger's
    // size on a phone, and with a mouse a table's, clear of its rows' handles.
    <section className="border-t border-line py-5 pr-6 pl-9 sm:pr-8 sm:pl-12">
      <div className="mb-3 flex items-center gap-2">
        {icon && <span className="text-ink-3 [&_svg]:size-[15px]">{icon}</span>}
        <h3 className="text-[11.5px] font-semibold tracking-[0.08em] text-ink-3 uppercase">{title}</h3>
        <span className="ml-auto">{action}</span>
      </div>
      {children}
    </section>
  )
}

function CardBody({ card, board, onClose }: { card: CardDetailDTO; board: BoardDTO; onClose: () => void }) {
  const { t } = useTranslation(['boards', 'common'])
  const { workspaceId, me } = useWorkspace()
  const confirm = useConfirm()
  const agent = useAgentHighlight(card.id)
  const [title, setTitle] = useState(card.title)
  // For saving a title still being typed when the sheet goes away (the card moved to another board, say).
  const titleDraft = useRef(title)
  titleDraft.current = title
  const cardTitle = useRef(card.title)
  cardTitle.current = card.title
  const sentTitle = useRef<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const phrasedTitle = usePhrasedField(title, TITLE_TYPE)
  const descTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  /** Description typed but not saved yet. */
  const pendingDesc = useRef<string | null>(null)
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle')
  const editorRef = useRef<TiptapEditor | null>(null)
  /** Version of the description the editor started from: saves are refused if it changed meanwhile. */
  const version = useRef(card.version)
  const savingDesc = useRef(false)
  /** Who last changed the description elsewhere, as live updates tell it. */
  const lastEditor = useRef<ActorRef | null>(null)
  /** Who changed the description under the editor; `by: null` is another session of this user. */
  const [conflict, setConflict] = useState<{ by: string | null } | null>(null)
  const conflictRef = useRef(false)
  conflictRef.current = conflict !== null
  const mounted = useRef(true)

  useEffect(() => setTitle(card.title), [card.title])
  useEffect(() => fitTitle(titleRef.current), [title])

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.card(card.id) }),
      queryClient.invalidateQueries({ queryKey: keys.board(card.boardId) }),
    ])

  // Where it is in its column, as the board shows it; moving takes the place among the others.
  const inColumn = board.cards.filter((c) => c.columnId === card.columnId).sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : a.id < b.id ? -1 : 1))
  const place = inColumn.findIndex((c) => c.id === card.id)
  const moveTo = async (columnId: string, index: number) => {
    try {
      await post(`/cards/${card.id}/move`, { columnId, index })
      await refresh()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  /** Puts a saved card in the caches. The description and its version only ever change together. */
  function applySummary(summary: CardSummaryDTO, description?: string) {
    queryClient.setQueryData<BoardDTO>(keys.board(card.boardId), (prev) => (prev ? { ...prev, cards: prev.cards.map((c) => (c.id === summary.id ? summary : c)) } : prev))
    queryClient.setQueryData<CardDetailDTO>(keys.card(card.id), (prev) => {
      if (!prev) return prev
      // A refetch may already hold a newer description than this answer: keep it.
      const text = description !== undefined && summary.version > prev.version ? { description, version: summary.version } : { description: prev.description, version: prev.version }
      return { ...prev, ...summary, ...text }
    })
  }

  async function update(body: Record<string, unknown>) {
    try {
      applySummary(await patch<CardSummaryDTO>(`/cards/${card.id}`, body))
      return true
    } catch (error) {
      toast.error(errorMessage(error))
      return false
    }
  }

  /** The name to show for who changed the description; null for another session of this user. */
  const actorName = (actor: ActorRef | null) => (actor && !(actor.kind === 'user' && actor.id === me.user.id) ? actor.name : null)

  function showDescription(latest: Pick<CardDetailDTO, 'version' | 'description'>) {
    version.current = latest.version
    pendingDesc.current = null
    clearTimeout(descTimer.current)
    const editor = editorRef.current
    if (!editor) return
    // The toggles the reader opened or closed stay so.
    const shown = togglesShown(editor.state.doc)
    editor.commands.setContent(latest.description, { contentType: 'markdown', emitUpdate: false })
    showTogglesAsBefore(editor, shown)
  }

  /** Shows a newer description from elsewhere, or flags a conflict if there are edits it would discard. */
  function catchUp(latest: Pick<CardDetailDTO, 'version' | 'description'> | undefined) {
    if (!latest || latest.version <= version.current || savingDesc.current) return
    if (pendingDesc.current !== null) {
      setConflict((c) => c ?? { by: actorName(lastEditor.current) })
      return
    }
    showDescription(latest)
    const by = lastEditor.current
    lastEditor.current = null
    if (by?.kind === 'agent') toast(t('sheet.agentUpdated', { name: by.name }), { icon: <Bot className="size-4 text-agent" />, duration: 2500 })
  }

  const flushDescription = async () => {
    clearTimeout(descTimer.current)
    if (pendingDesc.current === null || savingDesc.current || conflictRef.current) return
    const description = pendingDesc.current
    pendingDesc.current = null
    savingDesc.current = true
    setSaving('saving')
    try {
      const summary = await patch<CardSummaryDTO>(`/cards/${card.id}`, { description, baseVersion: version.current })
      version.current = summary.version
      applySummary(summary, description)
      setSaving(pendingDesc.current === null ? 'saved' : 'idle')
    } catch (error) {
      // Keep the text so it can still be saved, unless newer typing replaced it.
      pendingDesc.current ??= description
      setSaving('idle')
      if (error instanceof ApiError && error.status === 409) {
        if (mounted.current) setConflict((c) => c ?? { by: actorName(lastEditor.current) })
        else toast.error(t('sheet.conflict.notSaved'))
      } else toast.error(errorMessage(error))
      return
    } finally {
      savingDesc.current = false
    }
    // Typing during the save is saved next, even if the sheet closed meanwhile.
    if (pendingDesc.current !== null) void flushDescription()
    // Or a change from elsewhere arrived during the save.
    else if (mounted.current) catchUp(queryClient.getQueryData<CardDetailDTO>(keys.card(card.id)))
  }

  // Save pending description edits when the sheet closes.
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (conflictRef.current) toast.error(t('sheet.conflict.notSaved'))
      else void flushDescription()
      // Removing the title field doesn't blur it: save what was typed, unless it is already on its way.
      const next = titleDraft.current.trim()
      if (next && next !== cardTitle.current && next !== sentTitle.current) void update({ title: next })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // A newer description reaches the card through live updates (which refetch it) or any other refetch.
  useEffect(() => catchUp(card), [card.version]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () =>
      onCardEvent((event) => {
        if (event.cardId !== card.id || event.version === undefined || event.version <= version.current) return
        lastEditor.current = event.actor
        // The refusal of a save can arrive before the news of who changed the text.
        if (conflictRef.current) setConflict({ by: actorName(event.actor) })
      }),
    [card.id, me.user.id], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const fetchCard = () => queryClient.fetchQuery({ queryKey: keys.card(card.id), queryFn: () => get<CardDetailDTO>(`/cards/${card.id}`), staleTime: 0 })

  async function loadTheirs() {
    showDescription(await fetchCard())
    lastEditor.current = null
    setConflict(null)
    setSaving('idle')
  }

  async function keepMine() {
    const fresh = await fetchCard()
    version.current = fresh.version
    pendingDesc.current = editorRef.current?.getMarkdown() ?? pendingDesc.current
    lastEditor.current = null
    setConflict(null)
    conflictRef.current = false
    await flushDescription()
  }

  const labels = board.labels.filter((l) => card.labelIds.includes(l.id))

  return (
    <>
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-4">
        <MenuRoot>
          <MenuTrigger asChild>
            <button type="button" className="flex h-7.5 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2.5 text-[12.5px] font-medium shadow-sm hover:border-line-strong">
              <Columns3 className="size-3.5 text-ink-3" />
              {card.column.name}
              <ChevronDown className="size-3.5 text-ink-3" />
            </button>
          </MenuTrigger>
          <MenuContent align="start">
            {board.columns.map((c) => (
              <MenuItem key={c.id} disabled={c.id === card.columnId} onSelect={() => void moveTo(c.id, 100_000)}>
                {c.name}
              </MenuItem>
            ))}
            {/* Without dragging (on a phone, say): one place up or down in its column. */}
            {!card.archivedAt && (
              <>
                <MenuSeparator />
                <MenuItem icon={<ArrowUp />} disabled={place <= 0} onSelect={() => void moveTo(card.columnId, place - 1)}>
                  {t('sheet.moveUp')}
                </MenuItem>
                <MenuItem icon={<ArrowDown />} disabled={place < 0 || place >= inColumn.length - 1} onSelect={() => void moveTo(card.columnId, place + 1)}>
                  {t('sheet.moveDown')}
                </MenuItem>
              </>
            )}
          </MenuContent>
        </MenuRoot>
        {card.archivedAt && <span className="rounded-full bg-sunken px-2 py-0.5 text-[11.5px] font-medium text-ink-3">{t('sheet.archived')}</span>}
        {agent && (
          <span className="animate-pop inline-flex items-center gap-1 rounded-full bg-agent-soft px-2 py-0.5 text-[11.5px] font-medium text-agent">
            <Bot className="size-3" /> {t('sheet.agentEditing', { name: agent })}
          </span>
        )}
        <span className="ml-auto text-[11.5px] text-ink-3" aria-live="polite">
          {saving === 'saving' ? t('sheet.saving') : saving === 'saved' ? t('sheet.saved') : ''}
        </span>
        <MenuRoot>
          <MenuTrigger asChild>
            <Button variant="ghost" size="sm" iconOnly icon={<Ellipsis />} aria-label={t('sheet.actions')} />
          </MenuTrigger>
          <MenuContent>
            {card.archivedAt ? (
              <MenuItem
                icon={<ArchiveX />}
                onSelect={async () => {
                  await post(`/cards/${card.id}/restore`).catch((e) => toast.error(errorMessage(e)))
                  await refresh()
                  await queryClient.invalidateQueries({ queryKey: keys.archived(card.boardId) })
                }}
              >
                {t('actions.restore')}
              </MenuItem>
            ) : (
              <MenuItem
                icon={<Archive />}
                onSelect={async () => {
                  await post(`/cards/${card.id}/archive`).catch((e) => toast.error(errorMessage(e)))
                  await refresh()
                  toast.success(t('sheet.archivedToast'), {
                    action: {
                      label: t('actions.undo'),
                      onClick: async () => {
                        await post(`/cards/${card.id}/restore`)
                        await refresh()
                      },
                    },
                  })
                  onClose()
                }}
              >
                {t('actions.archive')}
              </MenuItem>
            )}
            <MenuItem icon={<History />} onSelect={() => setHistoryOpen(true)}>
              {t('sheet.history')}
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={<Trash />}
              danger
              onSelect={async () => {
                if (!(await confirm({ title: t('sheet.deleteConfirm.title'), description: `${t('sheet.deleteConfirm.description')} ${trashNote()}`, confirmLabel: t('actions.delete'), danger: true }))) return
                deletingHere.add(card.id)
                onClose()
                try {
                  const trashed = await del<TrashedDTO>(`/cards/${card.id}`)
                  await queryClient.invalidateQueries({ queryKey: keys.board(card.boardId) })
                  toastTrashed(t('sheet.deleted'), trashed)
                } catch (error) {
                  // Still there: deleting it later, here or elsewhere, counts as usual.
                  deletingHere.delete(card.id)
                  toast.error(errorMessage(error))
                }
              }}
            >
              {t('actions.delete')}
            </MenuItem>
          </MenuContent>
        </MenuRoot>
        <SheetClose asChild>
          <Button variant="ghost" size="sm" iconOnly icon={<X />} aria-label={t('common:actions.close')} />
        </SheetClose>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Wider on the left, as each Section: the room the description's block handle takes, a finger's size on a phone. */}
        <div className="pt-6 pr-6 pb-5 pl-9 sm:pr-8 sm:pl-12">
          <div className="grid">
            <textarea
              ref={titleRef}
              value={title}
              rows={1}
              maxLength={300}
              aria-label={t('card.title')}
              onFocus={phrasedTitle.onFocus}
              onPointerDown={phrasedTitle.onPointerDown}
              onClick={phrasedTitle.onClick}
              onChange={(e) => setTitle(e.target.value.replace(/\n/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isConverting(e)) {
                  e.preventDefault()
                  e.currentTarget.blur()
                }
              }}
              onBlur={() => {
                phrasedTitle.onBlur()
                const next = title.trim()
                if (next && next !== card.title) {
                  sentTitle.current = next
                  void update({ title: next })
                } else setTitle(card.title)
              }}
              className={cn('orq-title block w-full resize-none self-stretch overflow-hidden bg-transparent outline-none [grid-area:1/1]', TITLE_TYPE, phrasedTitle.hidden && 'opacity-0')}
            />
            {phrasedTitle.overlay}
          </div>
          <div className="mt-5 flex flex-col gap-1">
            <Row icon={<Tag />} label={t('sheet.labels')}>
              <LabelPicker
                board={board}
                selected={card.labelIds}
                onChange={(labelIds) => void update({ labelIds }).then(refresh)}
                trigger={
                  <button type="button" className="flex min-h-8 w-full flex-wrap items-center gap-1 rounded-[8px] px-1.5 py-1 text-left hover:bg-hover">
                    {labels.length ? (
                      labels.map((l) => (
                        <span key={l.id} className={cn('label-chip', `c-${l.color}`)}>
                          {l.name || t('labels.unnamed')}
                        </span>
                      ))
                    ) : (
                      <span className="text-[13px] text-ink-3">{t('sheet.addLabels')}</span>
                    )}
                  </button>
                }
              />
            </Row>
            <Row icon={<Calendar />} label={t('sheet.due')}>
              <DuePicker
                value={card.dueAt}
                onChange={(dueAt) => void update({ dueAt })}
                trigger={
                  <button type="button" className="flex h-8 items-center rounded-[8px] px-1.5 text-left hover:bg-hover">
                    {card.dueAt ? <DueChip dueAt={card.dueAt} /> : <span className="text-[13px] text-ink-3">{t('sheet.noDate')}</span>}
                  </button>
                }
              />
            </Row>
            <Row icon={<Avatar name={card.createdBy?.name ?? '?'} kind={card.createdBy?.kind ?? 'user'} size={15} />} label={t('sheet.createdBy')}>
              <span className="px-1.5 text-[13px] text-ink-2">
                <span className={card.createdBy?.kind === 'agent' ? 'font-medium text-agent' : undefined}>{card.createdBy?.name ?? t('sheet.unknownCreator')}</span>
                <span className="text-ink-3"> · {relativeTime(card.createdAt)}</span>
              </span>
            </Row>
          </div>
        </div>

        <Section title={t('sheet.description')}>
          {conflict && (
            <div role="alert" className="animate-pop mb-3 flex flex-wrap items-center gap-3 rounded-[12px] border border-warn/40 bg-[color-mix(in_oklab,var(--warn)_10%,var(--sheet))] px-4 py-3 text-[13px]">
              <TriangleAlert className="size-4 shrink-0 text-warn" />
              <span className="min-w-0 flex-1">
                {conflict.by ? (
                  <Trans t={t} i18nKey="sheet.conflict.byName" values={{ name: conflict.by }} components={{ strong: <strong className="font-semibold" /> }} />
                ) : (
                  <Trans t={t} i18nKey="sheet.conflict.byOtherSession" components={{ strong: <strong className="font-semibold" /> }} />
                )}
              </span>
              <Button size="sm" variant="secondary" disabled={saving === 'saving'} onClick={() => void loadTheirs().catch((e) => toast.error(errorMessage(e)))}>
                {t('sheet.conflict.loadTheirs')}
              </Button>
              <Button size="sm" variant="primary" disabled={saving === 'saving'} onClick={() => void keepMine().catch((e) => toast.error(errorMessage(e)))}>
                {t('sheet.conflict.keepMine')}
              </Button>
            </div>
          )}
          <Editor
            content={card.description}
            workspaceId={workspaceId}
            compact
            upload={{ type: 'card', id: card.id }}
            onUploaded={() => void refresh()}
            attachments={card.attachmentList}
            onReady={(editor) => (editorRef.current = editor)}
            placeholder={t('sheet.descriptionPlaceholder')}
            ariaLabel={t('sheet.descriptionLabel')}
            onChange={(md) => {
              pendingDesc.current = md
              setSaving('idle')
              clearTimeout(descTimer.current)
              descTimer.current = setTimeout(() => void flushDescription(), 900)
            }}
            className="-mx-1 rounded-[10px] px-1 focus-within:bg-surface/60"
          />
        </Section>

        <Section
          title={t('sheet.checklists')}
          icon={<ListChecks />}
          action={
            <button
              type="button"
              onClick={async () => {
                try {
                  await post(`/cards/${card.id}/checklists`, { title: t('sheet.newChecklistTitle') })
                  await refresh()
                } catch (error) {
                  toast.error(errorMessage(error))
                }
              }}
              className="text-[12px] font-medium text-ink-3 hover:text-ink"
            >
              {t('sheet.addChecklist')}
            </button>
          }
        >
          {card.checklists.length ? <Checklists card={card} /> : <p className="text-[13px] text-ink-3">{t('sheet.checklistsEmpty')}</p>}
        </Section>

        <Section title={t('sheet.linkedDocs')}>
          <LinkedPages card={card} />
        </Section>

        <Section title={t('sheet.attachments')}>
          <Attachments items={card.attachmentList} target={{ type: 'card', id: card.id }} onChanged={() => void refresh()} />
        </Section>

        <Section title={card.commentCount ? t('sheet.comments.titleCount', { count: card.commentCount }) : t('sheet.comments.title')} icon={<MessageSquare />}>
          <Comments card={card} />
        </Section>

        {card.activity.length > 0 && (
          <Section title={t('sheet.activity')}>
            <ActivityList items={card.activity} workspaceId={workspaceId} compact showSummary={false} />
          </Section>
        )}
      </div>
      <HistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} type="card" id={card.id} name={card.title} />
    </>
  )
}
