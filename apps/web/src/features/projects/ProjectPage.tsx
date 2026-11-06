import { FilePlus, FileText, Pencil, Plus, SquareKanban, Trash } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { cn } from '../../lib/cn'
import { plural, relativeTime } from '../../lib/format'
import { PageHeader } from '../shell/PageHeader'
import { ProjectSettingsDialog } from '../shell/ProjectSettingsDialog'
import { useStructureActions } from '../shell/actions'
import { NotFound } from '../shell/States'
import { useWorkspace } from '../shell/workspace'

export function ProjectPage() {
  const { projectId } = useParams()
  const { workspaceId, overview } = useWorkspace()
  const actions = useStructureActions(workspaceId)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const project = overview?.projects.find((p) => p.id === projectId)

  if (!overview) return <div className="p-10"><div className="skeleton h-10 w-1/3" /></div>
  if (!project) return <NotFound />

  const roots = project.pages.filter((p) => p.parentId === null)
  const childCount = (id: string) => project.pages.filter((p) => p.parentId === id).length
  const recent = [...project.pages].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumbs={[{ label: project.name }]}
        actions={
          <>
            <Button variant="ghost" size="sm" icon={<Pencil />} onClick={() => setSettingsOpen(true)}>
              <span className="max-sm:hidden">Editar</span>
            </Button>
            <Button variant="ghost" size="sm" iconOnly icon={<Trash />} aria-label="Eliminar proyecto" onClick={() => void actions.deleteProject(project)} />
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1040px] px-6 py-10 sm:px-10">
          <div className="animate-rise flex items-start gap-4">
            <span className={cn('glyph size-12 rounded-[12px] text-[22px]', `c-${project.color}`)}>{project.name[0]?.toUpperCase()}</span>
            <div className="min-w-0">
              <h1 className="font-display text-[34px] leading-tight font-medium tracking-[-0.02em]">{project.name}</h1>
              <p className="mt-1 text-[14px] text-ink-2">
                {project.description || `${plural(project.boards.length, 'tablero', 'tableros')} · ${plural(project.pages.length, 'página', 'páginas')}`}
              </p>
            </div>
          </div>

          <section className="mt-10">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[11.5px] font-semibold tracking-[0.08em] text-ink-3 uppercase">Tableros</h2>
              <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => void actions.createBoard(project.id)}>
                Nuevo tablero
              </Button>
            </div>
            {project.boards.length ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {project.boards.map((b, i) => (
                  <Link
                    key={b.id}
                    to={`/w/${workspaceId}/b/${b.id}`}
                    style={{ animationDelay: `${i * 40}ms` }}
                    className="animate-rise group relative overflow-hidden rounded-[14px] border border-line bg-surface p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-line-strong hover:shadow-md"
                  >
                    <div className="mb-6 flex gap-1.5" aria-hidden="true">
                      {[0.9, 0.6, 0.35].map((o, k) => (
                        <span key={k} className={cn('h-10 flex-1 rounded-[6px] bg-sunken', `c-${project.color}`)} style={{ boxShadow: `inset 0 3px 0 color-mix(in oklab, var(--c) ${o * 100}%, transparent)` }} />
                      ))}
                    </div>
                    <p className="flex items-center gap-2 text-[14.5px] font-semibold">
                      <SquareKanban className="size-4 text-ink-3" />
                      {b.name}
                    </p>
                    <p className="mt-0.5 text-[12.5px] text-ink-3">{plural(b.cardCount, 'tarjeta abierta', 'tarjetas abiertas')}</p>
                  </Link>
                ))}
              </div>
            ) : (
              <button type="button" onClick={() => void actions.createBoard(project.id)} className="w-full rounded-[14px] border border-dashed border-line-strong px-5 py-8 text-center text-[13.5px] text-ink-3 transition-colors hover:border-ink-3 hover:text-ink-2">
                Crea un tablero Kanban para organizar las tareas de este proyecto.
              </button>
            )}
          </section>

          <section className="mt-10 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[11.5px] font-semibold tracking-[0.08em] text-ink-3 uppercase">Documentos</h2>
                <Button size="sm" variant="ghost" icon={<FilePlus />} onClick={() => void actions.createPage(project.id)}>
                  Nueva página
                </Button>
              </div>
              {roots.length ? (
                <ul className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-sm">
                  {roots.map((p) => (
                    <li key={p.id} className="border-b border-line last:border-b-0">
                      <Link to={`/w/${workspaceId}/d/${p.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-hover">
                        <span className="w-5 text-center text-[16px]">{p.icon ?? <FileText className="size-4 text-ink-3" />}</span>
                        <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{p.title || 'Sin título'}</span>
                        {childCount(p.id) > 0 && <span className="text-[12px] text-ink-4">{plural(childCount(p.id), 'subpágina', 'subpáginas')}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={<FileText />} title="Sin documentos todavía" action={<Button variant="primary" icon={<FilePlus />} onClick={() => void actions.createPage(project.id)}>Escribir la primera página</Button>}>
                  Especificaciones, decisiones, procesos o notas de reunión. En Markdown y enlazados con tus tareas.
                </EmptyState>
              )}
            </div>
            {recent.length > 0 && (
              <div>
                <h2 className="mb-3 text-[11.5px] font-semibold tracking-[0.08em] text-ink-3 uppercase">Editado recientemente</h2>
                <ul className="flex flex-col gap-1">
                  {recent.map((p) => (
                    <li key={p.id}>
                      <Link to={`/w/${workspaceId}/d/${p.id}`} className="flex items-center gap-2.5 rounded-[9px] px-2 py-1.5 hover:bg-hover">
                        <span className="w-4 text-center text-[13px]">{p.icon ?? <FileText className="size-3.5 text-ink-3" />}</span>
                        <span className="min-w-0 flex-1 truncate text-[13.5px]">{p.title || 'Sin título'}</span>
                        <span className="text-[11.5px] text-ink-4">{relativeTime(p.updatedAt)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      </div>
      <ProjectSettingsDialog project={project} open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
