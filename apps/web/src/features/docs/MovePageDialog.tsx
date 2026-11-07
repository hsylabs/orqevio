import type { PageNodeDTO } from '@orqevio/shared'
import { CornerDownRight, FileText, FolderOpen } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog } from '../../components/ui/Dialog'
import { errorMessage, post } from '../../lib/api'
import { cn } from '../../lib/cn'
import { keys, queryClient } from '../../lib/queries'

export function MovePageDialog({ open, onOpenChange, pageId, projectName, pages, workspaceId }: { open: boolean; onOpenChange: (o: boolean) => void; pageId: string; projectName: string; pages: PageNodeDTO[]; workspaceId: string }) {
  // Exclude the page itself and its descendants.
  const blocked = new Set<string>([pageId])
  let grew = true
  while (grew) {
    grew = false
    for (const p of pages) if (p.parentId && blocked.has(p.parentId) && !blocked.has(p.id)) {
      blocked.add(p.id)
      grew = true
    }
  }
  const current = pages.find((p) => p.id === pageId)
  const ordered: Array<{ page: PageNodeDTO; depth: number }> = []
  const walk = (parent: string | null, depth: number) => {
    for (const p of pages.filter((x) => x.parentId === parent)) {
      if (blocked.has(p.id)) continue
      ordered.push({ page: p, depth })
      walk(p.id, depth + 1)
    }
  }
  walk(null, 0)

  async function move(parentId: string | null) {
    try {
      await post(`/pages/${pageId}/move`, { parentId, index: 100_000 })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.overview(workspaceId) }),
        queryClient.invalidateQueries({ queryKey: keys.page(pageId) }),
      ])
      onOpenChange(false)
      toast.success('Página movida')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Mover página" description="Elige dónde colocarla dentro del proyecto.">
      <div className="flex max-h-[50vh] flex-col gap-0.5 overflow-y-auto">
        <button type="button" disabled={current?.parentId === null} onClick={() => void move(null)} className="flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-[13.5px] hover:bg-hover disabled:opacity-40">
          <FolderOpen className="size-4 text-ink-3" />
          <span className="font-medium">{projectName}</span>
          <span className="text-[12px] text-ink-3">raíz del proyecto</span>
        </button>
        {ordered.map(({ page, depth }) => (
          <button
            key={page.id}
            type="button"
            disabled={current?.parentId === page.id}
            onClick={() => void move(page.id)}
            style={{ paddingLeft: 10 + depth * 18 }}
            className={cn('flex items-center gap-2.5 rounded-[9px] py-2 pr-2.5 text-left text-[13.5px] hover:bg-hover disabled:opacity-40')}
          >
            {depth > 0 ? <CornerDownRight className="size-3.5 text-ink-4" /> : null}
            <span className="w-4 text-center text-[13px]">{page.icon ?? <FileText className="size-4 text-ink-3" />}</span>
            <span className="truncate">{page.title || 'Sin título'}</span>
          </button>
        ))}
      </div>
    </Dialog>
  )
}
