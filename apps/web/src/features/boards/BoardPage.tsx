import type { BoardDTO, CardSummaryDTO, ColumnDTO, LabelDTO } from '@orqevio/shared'
import {
  type Announcements,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  MeasuringStrategy,
  getFirstCollision,
  type KeyboardCoordinateGetter,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { Archive, Ellipsis, ListFilter, Pencil, Plus, SquareKanban, Trash, X } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { useConfirm } from '../../components/ui/confirm'
import { EmptyState } from '../../components/ui/EmptyState'
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from '../../components/ui/Menu'
import { Popover } from '../../components/ui/Popover'
import { usePrompt } from '../../components/ui/prompt'
import { del, errorMessage, patch, post } from '../../lib/api'
import { cn } from '../../lib/cn'
import { dueState } from '../../lib/format'
import { keys, queryClient, useBoard } from '../../lib/queries'
import { PageHeader } from '../shell/PageHeader'
import { useStructureActions } from '../shell/actions'
import { NotFound } from '../shell/States'
import { useWorkspace } from '../shell/workspace'
import { ArchivedPanel } from './ArchivedPanel'
import { BoardColumn } from './BoardColumn'
import { CardView } from './CardItem'
import { CardSheet } from './CardSheet'

type DueFilter = 'all' | 'overdue' | 'week' | 'none'
interface Filter {
  text: string
  labels: string[]
  due: DueFilter
}

const announcementsFor = (title: (id: string | number) => string, where: (id: string | number) => string): Announcements => ({
  onDragStart: ({ active }) => `Has cogido ${title(active.id)}. ${where(active.id)}.`,
  onDragOver: ({ active, over }) => (over ? `${title(active.id)}: ${where(active.id)}.` : `${title(active.id)} no está sobre una zona válida.`),
  onDragEnd: ({ active, over }) => (over ? `${title(active.id)} se ha soltado. ${where(active.id)}.` : `${title(active.id)} se ha soltado.`),
  onDragCancel: ({ active }) => `Movimiento de ${title(active.id)} cancelado.`,
})

export function BoardPage() {
  const { boardId = '' } = useParams()
  const { workspaceId } = useWorkspace()
  const board = useBoard(boardId)
  const [params, setParams] = useSearchParams()
  const openCardId = params.get('card')
  const navigate = useNavigate()
  const prompt = usePrompt()
  const confirm = useConfirm()
  const actions = useStructureActions(workspaceId)
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [filter, setFilter] = useState<Filter>({ text: '', labels: [], due: 'all' })

  const data = board.data
  const [columnOrder, setColumnOrder] = useState<string[]>([])
  const [items, setItems] = useState<Record<string, string[]>>({})
  const [active, setActive] = useState<{ id: string; type: 'card' | 'column' } | null>(null)
  const dragging = useRef(false)
  const pending = useRef(0)
  const snapshot = useRef<{ columnOrder: string[]; items: Record<string, string[]> } | null>(null)

  // Mirror server order into local state unless a drag or a move is in flight.
  useEffect(() => {
    if (!data || dragging.current || pending.current > 0) return
    setColumnOrder(data.columns.map((c) => c.id))
    const next: Record<string, string[]> = {}
    for (const c of data.columns) next[c.id] = []
    for (const card of data.cards) next[card.columnId]?.push(card.id)
    setItems(next)
  }, [data])

  const cardsById = useMemo(() => new Map((data?.cards ?? []).map((c) => [c.id, c])), [data])
  const columnsById = useMemo(() => new Map((data?.columns ?? []).map((c) => [c.id, c])), [data])
  const labelsById = useMemo(() => new Map((data?.labels ?? []).map((l) => [l.id, l])), [data])

  const filtering = filter.text.trim() !== '' || filter.labels.length > 0 || filter.due !== 'all'
  const matches = useCallback(
    (card: CardSummaryDTO) => {
      if (filter.text.trim() && !card.title.toLowerCase().includes(filter.text.trim().toLowerCase())) return false
      if (filter.labels.length && !filter.labels.some((l) => card.labelIds.includes(l))) return false
      if (filter.due === 'none' && card.dueAt) return false
      if (filter.due === 'overdue' && (!card.dueAt || dueState(card.dueAt) !== 'overdue')) return false
      if (filter.due === 'week') {
        if (!card.dueAt) return false
        const days = (new Date(card.dueAt).getTime() - Date.now()) / 86_400_000
        if (days > 7) return false
      }
      return true
    },
    [filter],
  )

  // Keyboard dragging: ←/→ jump to the neighbouring column, ↑/↓ reorder within it.
  const itemsRef = useRef(items)
  itemsRef.current = items
  const orderRef = useRef(columnOrder)
  orderRef.current = columnOrder
  // Column the keyboard-dragged item is heading to; updated synchronously so rapid key presses stay correct.
  const keyboardColumn = useRef<string | null>(null)
  const coordinateGetter = useCallback<KeyboardCoordinateGetter>((event, args) => {
    const { active, droppableRects, droppableContainers } = args.context
    if (active && (event.code === 'ArrowRight' || event.code === 'ArrowLeft')) {
      event.preventDefault()
      const order = orderRef.current
      const isColumn = active.data.current?.type === 'column'
      const activeId = String(active.id)
      const current = keyboardColumn.current ?? (isColumn ? activeId : order.find((col) => itemsRef.current[col]?.includes(activeId)) ?? null)
      const target = current ? order[order.indexOf(current) + (event.code === 'ArrowRight' ? 1 : -1)] : undefined
      // Rects may not be measured yet right after lifting; fall back to the DOM node.
      const rect = target ? (droppableRects.get(target) ?? droppableContainers.get(target)?.node.current?.getBoundingClientRect()) : undefined
      if (!target || !rect) return args.currentCoordinates
      keyboardColumn.current = target
      return isColumn ? { x: rect.left, y: rect.top } : { x: rect.left + 8, y: rect.top + 52 }
    }
    return sortableKeyboardCoordinates(event, args)
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter, keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] } }),
  )

  const findColumn = useCallback(
    (id: string) => (id in items ? id : Object.keys(items).find((col) => items[col]!.includes(id))),
    [items],
  )

  // Collision strategy for multiple sortable containers (after dnd-kit's reference example):
  // prefer cards inside the hovered column and keep the last target while layouts settle,
  // which avoids oscillation right after a card changes column.
  const lastOverId = useRef<string | null>(null)
  const recentlyMoved = useRef(false)
  const collision: CollisionDetection = useCallback((args) => {
    if (args.active.data.current?.type === 'column') {
      return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => c.data.current?.type === 'column') })
    }
    const pointerHits = pointerWithin(args)
    const hits = pointerHits.length > 0 ? pointerHits : rectIntersection(args)
    let overId = getFirstCollision(hits, 'id')
    if (overId != null) {
      const columnItems = itemsRef.current[String(overId)]
      if (columnItems && columnItems.length > 0) {
        const closest = closestCenter({
          ...args,
          droppableContainers: args.droppableContainers.filter((c) => c.id !== overId && columnItems.includes(String(c.id))),
        })[0]
        if (closest) overId = closest.id
      }
      lastOverId.current = String(overId)
      return [{ id: overId }]
    }
    if (recentlyMoved.current) lastOverId.current = String(args.active.id)
    return lastOverId.current ? [{ id: lastOverId.current }] : []
  }, [])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      recentlyMoved.current = false
    })
    return () => cancelAnimationFrame(frame)
  }, [items])

  const title = (id: string | number) => {
    const key = String(id)
    return cardsById.get(key)?.title ? `la tarjeta «${cardsById.get(key)!.title}»` : columnsById.get(key) ? `la columna «${columnsById.get(key)!.name}»` : 'el elemento'
  }

  const where = (id: string | number) => {
    const key = String(id)
    if (columnsById.has(key)) {
      const order = orderRef.current
      return `posición ${order.indexOf(key) + 1} de ${order.length}`
    }
    const col = orderRef.current.find((c) => itemsRef.current[c]?.includes(key))
    if (!col) return ''
    const list = itemsRef.current[col]!
    return `columna «${columnsById.get(col)?.name ?? ''}», posición ${list.indexOf(key) + 1} de ${list.length}`
  }

  function onDragStart({ active: a }: DragStartEvent) {
    dragging.current = true
    keyboardColumn.current = null
    snapshot.current = { columnOrder, items }
    setActive({ id: String(a.id), type: a.data.current?.type === 'column' ? 'column' : 'card' })
  }

  function onDragOver({ active: a, over }: DragOverEvent) {
    if (!over || a.data.current?.type !== 'card') return
    const activeId = String(a.id)
    const overId = String(over.id)
    // Resolve containers from the latest state inside the updater: handlers can run
    // with a stale closure, and recomputing here keeps the update idempotent.
    setItems((prev) => {
      const locate = (id: string) => (id in prev ? id : Object.keys(prev).find((col) => prev[col]!.includes(id)))
      const from = locate(activeId)
      const to = locate(overId)
      if (!from || !to || from === to) return prev
      const target = prev[to]!.filter((id) => id !== activeId)
      const overIndex = target.indexOf(overId)
      const below = a.rect.current.translated && over.rect ? a.rect.current.translated.top > over.rect.top + over.rect.height / 2 : false
      const index = overId in prev ? target.length : overIndex >= 0 ? overIndex + (below ? 1 : 0) : target.length
      const next = {
        ...prev,
        [from]: prev[from]!.filter((id) => id !== activeId),
        [to]: [...target.slice(0, index), activeId, ...target.slice(index)],
      }
      itemsRef.current = next
      recentlyMoved.current = true
      return next
    })
  }

  async function persist(fn: () => Promise<unknown>) {
    pending.current++
    try {
      await fn()
    } catch (error) {
      toast.error(errorMessage(error))
      if (snapshot.current) {
        setColumnOrder(snapshot.current.columnOrder)
        setItems(snapshot.current.items)
      }
    } finally {
      pending.current--
      if (pending.current === 0) void queryClient.invalidateQueries({ queryKey: keys.board(boardId) })
    }
  }

  function onDragEnd({ active: a, over }: DragEndEvent) {
    dragging.current = false
    keyboardColumn.current = null
    setActive(null)
    if (!over || !data) return
    const activeId = String(a.id)
    const overId = String(over.id)

    if (a.data.current?.type === 'column') {
      const overColumn = findColumn(overId) ?? overId
      const from = columnOrder.indexOf(activeId)
      const to = columnOrder.indexOf(overColumn)
      if (from < 0 || to < 0 || from === to) return
      setColumnOrder(arrayMove(columnOrder, from, to))
      void persist(() => patch(`/columns/${activeId}`, { index: to }))
      return
    }

    const latest = itemsRef.current
    const column = activeId in latest ? undefined : Object.keys(latest).find((col) => latest[col]!.includes(activeId))
    if (!column) return
    let list = latest[column]!
    const oldIndex = list.indexOf(activeId)
    const overIndex = list.indexOf(overId)
    if (overIndex >= 0 && overIndex !== oldIndex) {
      list = arrayMove(list, oldIndex, overIndex)
      const moved = list
      setItems((prev) => ({ ...prev, [column]: moved }))
    }
    const index = list.indexOf(activeId)
    const original = data.cards.find((c) => c.id === activeId)
    const originalIndex = data.cards.filter((c) => c.columnId === original?.columnId).findIndex((c) => c.id === activeId)
    if (original?.columnId === column && originalIndex === index) return
    void persist(() => post(`/cards/${activeId}/move`, { columnId: column, index }))
  }

  function onDragCancel() {
    dragging.current = false
    keyboardColumn.current = null
    setActive(null)
    if (snapshot.current) {
      setColumnOrder(snapshot.current.columnOrder)
      setItems(snapshot.current.items)
    }
  }

  const openCard = useCallback(
    (id: string) => {
      setParams((p) => {
        p.set('card', id)
        return p
      })
    },
    [setParams],
  )

  async function addCard(columnId: string, title: string) {
    try {
      const card = await post<CardSummaryDTO>(`/columns/${columnId}/cards`, { title })
      queryClient.setQueryData<BoardDTO>(keys.board(boardId), (prev) => (prev ? { ...prev, cards: [...prev.cards, card] } : prev))
      void queryClient.invalidateQueries({ queryKey: keys.overview(workspaceId) })
    } catch (error) {
      toast.error(errorMessage(error))
      throw error
    }
  }

  async function renameColumn(columnId: string, name: string) {
    try {
      await patch(`/columns/${columnId}`, { name })
      await queryClient.invalidateQueries({ queryKey: keys.board(boardId) })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function deleteColumn(column: ColumnDTO, count: number) {
    const ok = await confirm({
      title: `¿Eliminar la columna «${column.name}»?`,
      description: count ? `Se eliminarán también sus ${count} tarjetas. Si prefieres conservarlas, muévelas antes a otra columna.` : 'La columna está vacía.',
      confirmLabel: 'Eliminar columna',
      danger: true,
    })
    if (!ok) return
    try {
      await del(`/columns/${column.id}`)
      await queryClient.invalidateQueries({ queryKey: keys.board(boardId) })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function renameBoard() {
    if (!data) return
    const name = await prompt({ title: 'Renombrar tablero', label: 'Nombre', initialValue: data.name, maxLength: 80 })
    if (!name || name === data.name) return
    try {
      await patch(`/boards/${boardId}`, { name })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.board(boardId) }),
        queryClient.invalidateQueries({ queryKey: keys.overview(workspaceId) }),
      ])
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  if (board.isError) return <NotFound />

  const activeCard = active?.type === 'card' ? cardsById.get(active.id) : undefined
  const activeColumn = active?.type === 'column' ? columnsById.get(active.id) : undefined

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumbs={
          data
            ? [
                { label: data.project.name, to: `/w/${workspaceId}/p/${data.project.id}` },
                { label: data.name },
              ]
            : [{ label: '…' }]
        }
        actions={
          data && (
            <>
              <FilterPopover filter={filter} onChange={setFilter} labels={data.labels} />
              <Button variant="ghost" size="sm" icon={<Archive />} onClick={() => setArchivedOpen(true)}>
                <span className="max-sm:hidden">Archivadas</span>
              </Button>
              <MenuRoot>
                <MenuTrigger asChild>
                  <Button variant="ghost" size="sm" iconOnly icon={<Ellipsis />} aria-label="Acciones del tablero" />
                </MenuTrigger>
                <MenuContent>
                  <MenuItem icon={<Pencil />} onSelect={renameBoard}>
                    Renombrar tablero
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem
                    icon={<Trash />}
                    danger
                    onSelect={async () => {
                      if (await actions.deleteBoard(data)) navigate(`/w/${workspaceId}/p/${data.projectId}`)
                    }}
                  >
                    Eliminar tablero
                  </MenuItem>
                </MenuContent>
              </MenuRoot>
            </>
          )
        }
      />

      {!data ? (
        <div className="flex gap-3 p-5" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-[60vh] w-[288px] rounded-[14px]" />
          ))}
        </div>
      ) : data.columns.length === 0 ? (
        <EmptyState icon={<SquareKanban />} title="Este tablero no tiene columnas" action={<AddColumn boardId={boardId} />}>
          Crea columnas para representar las fases de tu trabajo.
        </EmptyState>
      ) : (
        <div className="relative min-h-0 flex-1">
          {filtering && (
            <div className="animate-pop absolute top-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-surface py-1 pr-1 pl-3 text-[12px] text-ink-2 shadow-md">
              Filtro activo · arrastrar está desactivado
              <button type="button" onClick={() => setFilter({ text: '', labels: [], due: 'all' })} className="grid size-5 place-items-center rounded-full hover:bg-hover" aria-label="Quitar filtro">
                <X className="size-3" />
              </button>
            </div>
          )}
          <DndContext
            sensors={sensors}
            collisionDetection={collision}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDragCancel={onDragCancel}
            measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
            accessibility={{
              announcements: announcementsFor(title, where),
              screenReaderInstructions: { draggable: 'Para mover, pulsa espacio. Usa las flechas para desplazarte y espacio de nuevo para soltar. Escape cancela.' },
            }}
          >
            <div className="flex h-full items-start gap-3 overflow-x-auto overflow-y-hidden px-4 pt-4 pb-6 sm:px-5" role="region" aria-label={`Tablero ${data.name}`}>
              <SortableContext items={columnOrder} strategy={horizontalListSortingStrategy}>
                {columnOrder.map((id) => {
                  const column = columnsById.get(id)
                  if (!column) return null
                  const cards = (items[id] ?? []).map((cid) => cardsById.get(cid)).filter((c): c is CardSummaryDTO => Boolean(c))
                  return (
                    <BoardColumn
                      key={id}
                      column={column}
                      cards={filtering ? cards.filter(matches) : cards}
                      labels={labelsById}
                      dragDisabled={filtering}
                      filtered={filtering}
                      onOpenCard={openCard}
                      onAddCard={addCard}
                      onRename={renameColumn}
                      onDelete={deleteColumn}
                    />
                  )
                })}
              </SortableContext>
              <AddColumn boardId={boardId} />
            </div>
            <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }}>
              {activeCard ? (
                <div className="w-[272px]">
                  <CardView card={activeCard} labels={labelsById} overlay />
                </div>
              ) : activeColumn ? (
                <div className="flex h-24 w-[288px] rotate-[-1.5deg] items-start rounded-[14px] bg-sunken p-3 shadow-lg ring-1 ring-line-strong">
                  <span className="text-[13px] font-semibold">{activeColumn.name}</span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      )}

      {data && (
        <>
          <CardSheet
            cardId={openCardId}
            board={data}
            onClose={() =>
              setParams((p) => {
                p.delete('card')
                return p
              })
            }
          />
          <ArchivedPanel open={archivedOpen} onOpenChange={setArchivedOpen} board={data} onOpenCard={openCard} />
        </>
      )}
    </div>
  )
}

function AddColumn({ boardId }: { boardId: string }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    try {
      await post(`/boards/${boardId}/columns`, { name: name.trim() })
      await queryClient.invalidateQueries({ queryKey: keys.board(boardId) })
      setName('')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }
  return open ? (
    <form onSubmit={submit} className="animate-pop w-[288px] shrink-0 rounded-[14px] bg-sunken p-2 shadow-[inset_0_0_0_1px_var(--line)]">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        onBlur={() => !name.trim() && setOpen(false)}
        placeholder="Nombre de la columna"
        aria-label="Nombre de la columna"
        maxLength={60}
        className="field h-9"
      />
      <div className="mt-2 flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
        <Button size="sm" variant="primary" type="submit" disabled={!name.trim()}>
          Añadir columna
        </Button>
      </div>
    </form>
  ) : (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="flex h-11 w-[288px] shrink-0 items-center gap-2 rounded-[14px] border border-dashed border-line-strong px-3.5 text-[13px] text-ink-3 transition-colors hover:border-ink-3 hover:bg-hover hover:text-ink"
    >
      <Plus className="size-[15px]" />
      Añadir columna
    </button>
  )
}

function FilterPopover({ filter, onChange, labels }: { filter: Filter; onChange: (f: Filter) => void; labels: LabelDTO[] }) {
  const count = (filter.text.trim() ? 1 : 0) + filter.labels.length + (filter.due !== 'all' ? 1 : 0)
  const dues: Array<{ value: DueFilter; label: string }> = [
    { value: 'all', label: 'Todas' },
    { value: 'overdue', label: 'Vencidas' },
    { value: 'week', label: 'Esta semana' },
    { value: 'none', label: 'Sin fecha' },
  ]
  return (
    <Popover
      align="end"
      className="w-[300px] p-3"
      trigger={
        <Button variant={count ? 'secondary' : 'ghost'} size="sm" icon={<ListFilter />}>
          <span className="max-sm:hidden">Filtrar</span>
          {count > 0 && <span className="grid size-4.5 place-items-center rounded-full bg-accent font-mono text-[10px] text-accent-ink">{count}</span>}
        </Button>
      }
    >
      <input
        value={filter.text}
        onChange={(e) => onChange({ ...filter, text: e.target.value })}
        placeholder="Buscar por título…"
        aria-label="Buscar por título"
        className="field h-8.5"
        autoFocus
      />
      <p className="mt-3 mb-1.5 text-[11px] font-semibold tracking-[0.08em] text-ink-3 uppercase">Fecha</p>
      <div className="flex flex-wrap gap-1">
        {dues.map((d) => (
          <button
            key={d.value}
            type="button"
            onClick={() => onChange({ ...filter, due: d.value })}
            aria-pressed={filter.due === d.value}
            className={cn('h-7 rounded-full px-2.5 text-[12px] font-medium transition-colors', filter.due === d.value ? 'bg-ink text-sheet' : 'bg-sunken text-ink-2 hover:text-ink')}
          >
            {d.label}
          </button>
        ))}
      </div>
      {labels.length > 0 && (
        <>
          <p className="mt-3 mb-1.5 text-[11px] font-semibold tracking-[0.08em] text-ink-3 uppercase">Etiquetas</p>
          <div className="flex flex-wrap gap-1">
            {labels.map((l) => {
              const on = filter.labels.includes(l.id)
              return (
                <button
                  key={l.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange({ ...filter, labels: on ? filter.labels.filter((x) => x !== l.id) : [...filter.labels, l.id] })}
                  className={cn('label-chip transition-[box-shadow]', `c-${l.color}`, on && 'ring-2 ring-[var(--c)]')}
                >
                  {l.name || 'Sin nombre'}
                </button>
              )
            })}
          </div>
        </>
      )}
      {count > 0 && (
        <button type="button" onClick={() => onChange({ text: '', labels: [], due: 'all' })} className="mt-3 text-[12px] font-medium text-ink-3 hover:text-ink">
          Limpiar filtro
        </button>
      )}
    </Popover>
  )
}
