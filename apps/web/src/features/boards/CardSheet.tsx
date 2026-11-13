import type { BoardDTO, CardDetailDTO, CardSummaryDTO } from '@orqevio/shared'
import { Archive, ArchiveX, Bot, Calendar, ChevronDown, Columns3, Ellipsis, ListChecks, Tag, Trash, X } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ActivityList } from '../../components/ActivityList'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { useConfirm } from '../../components/ui/confirm'
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from '../../components/ui/Menu'
import { Sheet, SheetClose } from '../../components/ui/Sheet'
import { del, errorMessage, patch, post } from '../../lib/api'
import { cn } from '../../lib/cn'
import { relativeTime } from '../../lib/format'
import { keys, queryClient, useCard } from '../../lib/queries'
import { useAgentHighlight } from '../../lib/realtime'
import { Editor } from '../docs/editor/Editor'
import { useWorkspace } from '../shell/workspace'
import { Attachments } from './Attachments'
import { DueChip } from './CardItem'
import { Checklists } from './Checklists'
import { DuePicker } from './DuePicker'
import { LabelPicker } from './LabelPicker'
import { LinkedPages } from './LinkedPages'

export function CardSheet({ cardId, board, onClose }: { cardId: string | null; board: BoardDTO; onClose: () => void }) {
  const { t } = useTranslation(['boards', 'common'])
  const card = useCard(cardId)
  const open = Boolean(cardId)
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title={card.data?.title ?? t('sheet.fallbackTitle')} label={t('sheet.label')}>
      {card.data ? (
        <CardBody key={card.data.id} card={card.data} board={board} onClose={onClose} />
      ) : card.isError ? (
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
    <section className="border-t border-line px-6 py-5 sm:px-8">
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
  const { workspaceId } = useWorkspace()
  const confirm = useConfirm()
  const agent = useAgentHighlight(card.id)
  const [title, setTitle] = useState(card.title)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const descTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pendingDesc = useRef<string | null>(null)
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle')

  useEffect(() => setTitle(card.title), [card.title])
  useEffect(() => {
    const el = titleRef.current
    if (el) {
      el.style.height = '0'
      el.style.height = `${el.scrollHeight}px`
    }
  }, [title])

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.card(card.id) }),
      queryClient.invalidateQueries({ queryKey: keys.board(card.boardId) }),
    ])

  async function update(body: Record<string, unknown>) {
    try {
      const summary = await patch<CardSummaryDTO>(`/cards/${card.id}`, body)
      queryClient.setQueryData<BoardDTO>(keys.board(card.boardId), (prev) => (prev ? { ...prev, cards: prev.cards.map((c) => (c.id === summary.id ? summary : c)) } : prev))
      queryClient.setQueryData<CardDetailDTO>(keys.card(card.id), (prev) => (prev ? { ...prev, ...summary, description: (body.description as string | undefined) ?? prev.description } : prev))
      return true
    } catch (error) {
      toast.error(errorMessage(error))
      return false
    }
  }

  const flushDescription = async () => {
    clearTimeout(descTimer.current)
    if (pendingDesc.current === null) return
    const description = pendingDesc.current
    pendingDesc.current = null
    setSaving('saving')
    if (await update({ description })) setSaving('saved')
    else setSaving('idle')
  }

  // Save pending description edits when the sheet closes.
  useEffect(() => () => void flushDescription(), []) // eslint-disable-line react-hooks/exhaustive-deps

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
              <MenuItem
                key={c.id}
                disabled={c.id === card.columnId}
                onSelect={async () => {
                  try {
                    await post(`/cards/${card.id}/move`, { columnId: c.id, index: 100_000 })
                    await refresh()
                  } catch (error) {
                    toast.error(errorMessage(error))
                  }
                }}
              >
                {c.name}
              </MenuItem>
            ))}
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
            <MenuSeparator />
            <MenuItem
              icon={<Trash />}
              danger
              onSelect={async () => {
                if (!(await confirm({ title: t('sheet.deleteConfirm.title'), description: t('sheet.deleteConfirm.description'), confirmLabel: t('actions.delete'), danger: true }))) return
                try {
                  await del(`/cards/${card.id}`)
                  onClose()
                  await queryClient.invalidateQueries({ queryKey: keys.board(card.boardId) })
                } catch (error) {
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
        <div className="px-6 pt-6 pb-5 sm:px-8">
          <textarea
            ref={titleRef}
            value={title}
            rows={1}
            maxLength={300}
            aria-label={t('card.title')}
            onChange={(e) => setTitle(e.target.value.replace(/\n/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.blur()
              }
            }}
            onBlur={() => {
              const next = title.trim()
              if (next && next !== card.title) void update({ title: next })
              else setTitle(card.title)
            }}
            className="block w-full resize-none overflow-hidden bg-transparent font-display text-[26px] leading-[1.18] font-medium tracking-[-0.02em] outline-none"
          />
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
          <Editor
            content={card.description}
            workspaceId={workspaceId}
            compact
            upload={{ type: 'card', id: card.id }}
            onUploaded={() => void refresh()}
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

        {card.activity.length > 0 && (
          <Section title={t('sheet.activity')}>
            <ActivityList items={card.activity} workspaceId={workspaceId} compact showSummary={false} />
          </Section>
        )}
      </div>
    </>
  )
}
