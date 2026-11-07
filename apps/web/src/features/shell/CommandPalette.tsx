import { Command } from 'cmdk'
import { Dialog as D } from 'radix-ui'
import { Bot, FileText, FolderOpen, House, LockKeyhole, Moon, Plus, Search, Settings, SquareKanban, Sun } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { patch } from '../../lib/api'
import { useSearch } from '../../lib/queries'
import { applyTheme } from '../../lib/theme'
import { lockVault, useVaultLocked } from '../vault/session'
import { useWorkspace } from './workspace'

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { workspaceId, overview, openNewProject } = useWorkspace()
  const navigate = useNavigate()
  const vaultLocked = useVaultLocked()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const search = useSearch(workspaceId, debounced)
  const base = `/w/${workspaceId}`

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 160)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const go = (to: string) => {
    onOpenChange(false)
    navigate(to)
  }
  const run = (fn: () => void) => {
    onOpenChange(false)
    fn()
  }

  const projects = overview?.projects ?? []
  const contentResults = (search.data ?? []).filter(() => debounced.trim().length >= 2)
  const dark = document.documentElement.dataset.theme === 'dark'

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-[rgb(20_18_14/0.28)] backdrop-blur-[2px] data-[state=open]:animate-[overlay-in_0.15s_ease-out]" />
        <D.Content
          aria-label="Paleta de comandos"
          className="fixed top-[14vh] left-1/2 z-50 w-[calc(100vw-32px)] max-w-[620px] -translate-x-1/2 overflow-hidden rounded-[18px] border border-line bg-sheet shadow-lg outline-none data-[state=open]:animate-[pop_0.18s_var(--ease-out-quint)]"
        >
          <D.Title className="sr-only">Buscar</D.Title>
          <D.Description className="sr-only">Busca proyectos, tableros, páginas y tarjetas, o ejecuta una acción.</D.Description>
          <Command label="Paleta de comandos" loop className="flex max-h-[min(70vh,560px)] flex-col">
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="size-[18px] shrink-0 text-ink-3" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Busca tareas, documentos o acciones…"
                className="h-14 flex-1 bg-transparent text-[15.5px] outline-none placeholder:text-ink-3"
              />
              <kbd className="kbd">esc</kbd>
            </div>
            <Command.List className="min-h-0 flex-1 overflow-y-auto p-2 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-ink-3 [&_[cmdk-group-heading]]:uppercase">
              <Command.Empty className="px-4 py-10 text-center text-[13.5px] text-ink-3">
                {search.isFetching ? 'Buscando…' : 'Sin resultados. Prueba con otras palabras.'}
              </Command.Empty>

              {contentResults.length > 0 && (
                <Command.Group heading="En el contenido">
                  {contentResults.map((r) => (
                    <Item
                      key={`${r.type}-${r.id}`}
                      value={`content ${r.type} ${r.id} ${r.title}`}
                      keywords={[debounced]}
                      icon={r.type === 'card' ? <SquareKanban /> : r.icon ? <span className="text-[14px]">{r.icon}</span> : <FileText />}
                      onSelect={() => go(r.type === 'card' ? `${base}/b/${r.boardId}?card=${r.id}` : `${base}/d/${r.id}`)}
                      hint={r.type === 'card' ? `${r.boardName} · ${r.columnName}` : r.projectName}
                    >
                      <span className="block truncate">{r.title || 'Sin título'}</span>
                      {r.excerpt && <span className="block truncate text-[12px] text-ink-3">{r.excerpt}</span>}
                    </Item>
                  ))}
                </Command.Group>
              )}

              <Command.Group heading="Navegar">
                <Item value="Inicio" icon={<House />} onSelect={() => go(base)}>
                  Inicio
                </Item>
                <Item value="Bóveda contraseñas" icon={<LockKeyhole />} onSelect={() => go(`${base}/vault`)}>
                  Bóveda
                </Item>
                <Item value="Agentes MCP tokens" icon={<Bot />} onSelect={() => go(`${base}/agents`)}>
                  Agentes
                </Item>
                <Item value="Ajustes cuenta" icon={<Settings />} onSelect={() => go(`${base}/settings`)}>
                  Ajustes
                </Item>
              </Command.Group>

              {projects.length > 0 && (
                <Command.Group heading="Proyectos, tableros y páginas">
                  {projects.map((p) => (
                    <Item key={p.id} value={`proyecto ${p.name} ${p.id}`} icon={<FolderOpen />} onSelect={() => go(`${base}/p/${p.id}`)} hint="Proyecto">
                      {p.name}
                    </Item>
                  ))}
                  {projects.flatMap((p) =>
                    p.boards.map((b) => (
                      <Item key={b.id} value={`tablero ${b.name} ${p.name} ${b.id}`} icon={<SquareKanban />} onSelect={() => go(`${base}/b/${b.id}`)} hint={p.name}>
                        {b.name}
                      </Item>
                    )),
                  )}
                  {projects.flatMap((p) =>
                    p.pages.map((pg) => (
                      <Item
                        key={pg.id}
                        value={`página ${pg.title || 'Sin título'} ${p.name} ${pg.id}`}
                        icon={pg.icon ? <span className="text-[14px]">{pg.icon}</span> : <FileText />}
                        onSelect={() => go(`${base}/d/${pg.id}`)}
                        hint={p.name}
                      >
                        {pg.title || 'Sin título'}
                      </Item>
                    )),
                  )}
                </Command.Group>
              )}

              <Command.Group heading="Acciones">
                <Item value="Nuevo proyecto crear" icon={<Plus />} onSelect={() => run(openNewProject)}>
                  Nuevo proyecto
                </Item>
                <Item
                  value="Cambiar tema claro oscuro apariencia"
                  icon={dark ? <Sun /> : <Moon />}
                  onSelect={() =>
                    run(() => {
                      const next = dark ? 'light' : 'dark'
                      applyTheme(next)
                      void patch('/account', { theme: next }).catch(() => {})
                    })
                  }
                >
                  {dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
                </Item>
                {!vaultLocked && (
                  <Item value="Bloquear bóveda" icon={<LockKeyhole />} onSelect={() => run(lockVault)}>
                    Bloquear la bóveda
                  </Item>
                )}
              </Command.Group>
            </Command.List>
            <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[11.5px] text-ink-3">
              <span className="flex items-center gap-1.5">
                <kbd className="kbd">↑</kbd>
                <kbd className="kbd">↓</kbd> navegar
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="kbd">↵</kbd> abrir
              </span>
              {search.isFetching && <span className="ml-auto">Buscando…</span>}
            </div>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

function Item({ value, icon, children, onSelect, hint, keywords }: { value: string; icon: ReactNode; children: ReactNode; onSelect: () => void; hint?: string; keywords?: string[] }) {
  return (
    <Command.Item
      value={value}
      keywords={keywords}
      onSelect={onSelect}
      className="flex min-h-10 cursor-default items-center gap-3 rounded-[10px] px-2.5 py-1.5 text-[13.5px] text-ink outline-none select-none data-[selected=true]:bg-hover [&>svg]:size-[16px] [&>svg]:shrink-0 [&>svg]:text-ink-3"
    >
      <span className="grid size-[18px] shrink-0 place-items-center text-ink-3 [&>svg]:size-[16px]">{icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
      {hint && <span className="max-w-[40%] shrink-0 truncate text-[12px] text-ink-3">{hint}</span>}
    </Command.Item>
  )
}
