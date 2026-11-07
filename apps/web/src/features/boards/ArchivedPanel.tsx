import type { BoardDTO } from '@orqevio/shared'
import { Archive, ArchiveX, Trash, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { useConfirm } from '../../components/ui/confirm'
import { EmptyState } from '../../components/ui/EmptyState'
import { Sheet, SheetClose } from '../../components/ui/Sheet'
import { del, errorMessage, post } from '../../lib/api'
import { keys, queryClient, useArchived } from '../../lib/queries'
import { CardView } from './CardItem'

export function ArchivedPanel({ open, onOpenChange, board, onOpenCard }: { open: boolean; onOpenChange: (o: boolean) => void; board: BoardDTO; onOpenCard: (id: string) => void }) {
  const archived = useArchived(board.id, open)
  const confirm = useConfirm()
  const labels = new Map(board.labels.map((l) => [l.id, l]))
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.archived(board.id) }),
      queryClient.invalidateQueries({ queryKey: keys.board(board.id) }),
    ])

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Tarjetas archivadas" width="max-w-[420px]">
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-4">
        <Archive className="size-4 text-ink-3" />
        <h2 className="text-[14px] font-semibold">Archivadas</h2>
        <SheetClose asChild>
          <Button variant="ghost" size="sm" iconOnly icon={<X />} aria-label="Cerrar" className="ml-auto" />
        </SheetClose>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {archived.data?.length === 0 && (
          <EmptyState icon={<Archive />} title="Nada archivado">
            Las tarjetas que archives (tú o tus agentes) aparecerán aquí y podrás restaurarlas.
          </EmptyState>
        )}
        <ul className="flex flex-col gap-3">
          {archived.data?.map((card) => (
            <li key={card.id} className="list-none">
              <button type="button" className="block w-full text-left" onClick={() => onOpenCard(card.id)}>
                <CardView card={card} labels={labels} />
              </button>
              <div className="mt-1.5 flex gap-1">
                <Button
                  size="xs"
                  variant="ghost"
                  icon={<ArchiveX />}
                  onClick={async () => {
                    try {
                      await post(`/cards/${card.id}/restore`)
                      await refresh()
                    } catch (error) {
                      toast.error(errorMessage(error))
                    }
                  }}
                >
                  Restaurar
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  icon={<Trash />}
                  className="hover:text-danger"
                  onClick={async () => {
                    if (!(await confirm({ title: `¿Eliminar «${card.title}» definitivamente?`, confirmLabel: 'Eliminar', danger: true }))) return
                    try {
                      await del(`/cards/${card.id}`)
                      await refresh()
                    } catch (error) {
                      toast.error(errorMessage(error))
                    }
                  }}
                >
                  Eliminar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  )
}
