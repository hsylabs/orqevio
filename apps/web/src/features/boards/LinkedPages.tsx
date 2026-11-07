import type { CardDetailDTO } from '@orqevio/shared'
import { FileText, Link2, Search, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Popover } from '../../components/ui/Popover'
import { del, errorMessage, post } from '../../lib/api'
import { keys, queryClient, useSearch } from '../../lib/queries'
import { useWorkspace } from '../shell/workspace'

export function LinkedPages({ card }: { card: CardDetailDTO }) {
  const { workspaceId, overview } = useWorkspace()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const search = useSearch(workspaceId, query, 'page')
  const linked = new Set(card.pages.map((p) => p.id))
  const project = overview?.projects.find((p) => p.id === card.board.projectId)
  const suggestions =
    query.trim().length >= 2
      ? (search.data ?? []).map((r) => ({ id: r.id, title: r.title, icon: r.icon, hint: r.projectName }))
      : (project?.pages ?? []).slice(0, 8).map((p) => ({ id: p.id, title: p.title, icon: p.icon, hint: project?.name ?? '' }))

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.card(card.id) }),
      queryClient.invalidateQueries({ queryKey: keys.board(card.boardId) }),
    ])

  async function link(pageId: string) {
    try {
      await post(`/cards/${card.id}/pages`, { pageId })
      setOpen(false)
      setQuery('')
      await refresh()
      await queryClient.invalidateQueries({ queryKey: keys.page(pageId) })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function unlink(pageId: string) {
    try {
      await del(`/cards/${card.id}/pages/${pageId}`)
      await refresh()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {card.pages.map((p) => (
        <div key={p.id} className="group flex items-center gap-2.5 rounded-[10px] border border-line bg-surface px-2.5 py-2 transition-colors hover:border-line-strong">
          <span className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-sunken text-[14px] text-ink-3">{p.icon ?? <FileText className="size-4" />}</span>
          <Link to={`/w/${workspaceId}/d/${p.id}`} className="min-w-0 flex-1 truncate text-[13.5px] font-medium hover:underline hover:decoration-accent hover:underline-offset-2">
            {p.title || 'Sin título'}
          </Link>
          {p.sources.includes('mention') && <span className="rounded-full bg-sunken px-2 py-0.5 text-[11px] text-ink-3">mencionada</span>}
          {p.sources.includes('manual') && (
            <button type="button" onClick={() => void unlink(p.id)} aria-label={`Desvincular ${p.title || 'página'}`} className="grid size-6 place-items-center rounded-[6px] text-ink-3 opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-ink focus-visible:opacity-100">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      ))}
      <Popover
        open={open}
        onOpenChange={setOpen}
        className="w-[320px]"
        trigger={
          <button type="button" className="flex items-center gap-2 self-start rounded-[8px] px-1 py-1 text-[13px] text-ink-3 hover:text-ink">
            <Link2 className="size-4" />
            Vincular documento
          </button>
        }
      >
        <div className="flex items-center gap-2 border-b border-line px-2 pb-2">
          <Search className="size-4 text-ink-3" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar páginas…" aria-label="Buscar páginas" className="h-7 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-ink-3" />
        </div>
        <div className="max-h-[260px] overflow-y-auto pt-1">
          {suggestions.filter((s) => !linked.has(s.id)).length === 0 ? (
            <p className="px-2 py-3 text-[12.5px] text-ink-3">{query.trim().length >= 2 ? 'Sin resultados.' : 'Escribe para buscar en todo el espacio.'}</p>
          ) : (
            suggestions
              .filter((s) => !linked.has(s.id))
              .map((s) => (
                <button key={s.id} type="button" onClick={() => void link(s.id)} className="flex w-full items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left hover:bg-hover">
                  <span className="grid w-4 place-items-center text-[13px] text-ink-3">{s.icon ?? <FileText className="size-4" />}</span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px]">{s.title || 'Sin título'}</span>
                  <span className="shrink-0 text-[11.5px] text-ink-3">{s.hint}</span>
                </button>
              ))
          )}
        </div>
      </Popover>
    </div>
  )
}
