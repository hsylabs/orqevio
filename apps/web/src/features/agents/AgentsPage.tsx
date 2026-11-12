import type { TokenDTO } from '@orqevio/shared'
import { levelFromScopes } from '@orqevio/shared'
import { Bot, LockKeyhole, Plus, ShieldCheck, Trash as TrashIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ActivityList } from '../../components/ActivityList'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { CopyButton } from '../../components/ui/CopyButton'
import { useConfirm } from '../../components/ui/confirm'
import { del, errorMessage } from '../../lib/api'
import { cn } from '../../lib/cn'
import { relativeTime, shortDate } from '../../lib/format'
import { keys, queryClient, useActivity, useTokens } from '../../lib/queries'
import { PageHeader } from '../shell/PageHeader'
import { useWorkspace } from '../shell/workspace'
import { CreateTokenDialog } from './CreateTokenDialog'
import { mcpUrl } from './ConnectKit'
import { destination } from '../oauth/destination'

const LEVEL_LABEL = { none: 'Sin acceso', read: 'Lectura', write: 'Lectura y escritura' } as const

const TOOLS: Array<{ name: string; scope: string; description: string }> = [
  { name: 'list_projects', scope: 'Lectura', description: 'Proyectos, tableros y esquema de páginas' },
  { name: 'search', scope: 'Lectura', description: 'Búsqueda en tarjetas y páginas' },
  { name: 'get_board · get_card', scope: 'Tareas · lectura', description: 'Columnas, tarjetas, checklists y vínculos' },
  { name: 'create_card · update_card · move_card', scope: 'Tareas · escritura', description: 'Crear, editar y mover tarjetas' },
  { name: 'archive_card', scope: 'Tareas · escritura', description: 'Archivar (recuperable desde la app)' },
  { name: 'create_board · create_column · update_column', scope: 'Tareas · escritura', description: 'Reorganizar tableros' },
  { name: 'create_label · add_checklist_items · update_checklist_item', scope: 'Tareas · escritura', description: 'Etiquetas y checklists' },
  { name: 'list_pages · read_page', scope: 'Documentos · lectura', description: 'Árbol de páginas y contenido Markdown' },
  { name: 'create_page · update_page', scope: 'Documentos · escritura', description: 'Crear y actualizar con control de versión' },
  { name: 'link_card_to_page', scope: 'Escritura', description: 'Relacionar tareas y documentos' },
]

export function AgentsPage() {
  const { workspaceId } = useWorkspace()
  const tokens = useTokens()
  const [createOpen, setCreateOpen] = useState(false)
  const [tokenFilter, setTokenFilter] = useState<string | undefined>()
  const activity = useActivity(workspaceId, { agentsOnly: true, tokenId: tokenFilter })
  const confirm = useConfirm()

  const active = (tokens.data ?? []).filter((t) => !t.revokedAt && (!t.expiresAt || new Date(t.expiresAt) > new Date()))
  const inactive = (tokens.data ?? []).filter((t) => !active.includes(t))

  async function revoke(token: TokenDTO) {
    const ok = await confirm({
      title: `¿Revocar «${token.name}»?`,
      description: 'El agente perderá el acceso inmediatamente. Su actividad pasada se conserva.',
      confirmLabel: 'Revocar acceso',
      danger: true,
    })
    if (!ok) return
    try {
      await del(`/tokens/${token.id}`)
      await queryClient.invalidateQueries({ queryKey: keys.tokens })
      toast.success('Acceso revocado')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumbs={[{ label: 'Agentes' }]}
        actions={
          <Button variant="agent" size="sm" icon={<Plus />} onClick={() => setCreateOpen(true)}>
            Conectar un agente
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1080px] px-6 py-10 sm:px-10">
          <div className="animate-rise grid gap-6 lg:grid-cols-[1.3fr_1fr]">
            <div>
              <h1 className="font-display text-[34px] leading-tight font-medium tracking-[-0.02em]">Tus agentes, con permisos claros</h1>
              <p className="mt-2 max-w-[560px] text-[14px] leading-relaxed text-ink-2">
                Conecta cualquier cliente compatible con MCP para consultar documentación, crear tareas y reorganizar tableros. Cada token pertenece a un único espacio y solo hace lo que tú permites.
              </p>
              <div className="mt-5 flex max-w-[560px] items-center gap-2 rounded-[12px] border border-line bg-surface py-1.5 pr-1.5 pl-3.5 shadow-sm">
                <span className="text-[11.5px] font-semibold tracking-[0.06em] text-ink-3 uppercase">Endpoint</span>
                <code className="min-w-0 flex-1 truncate font-mono text-[13px]">{mcpUrl()}</code>
                <CopyButton value={mcpUrl()} label="Copiar endpoint" message="Endpoint copiado" />
              </div>
              <p className="mt-3 max-w-[560px] text-[13px] leading-relaxed text-ink-3">
                En Claude (web, escritorio y móvil) añade un conector personalizado con este endpoint: no necesitas token, te pedirá permiso aquí. Funciona igual con cualquier cliente que admita OAuth.
              </p>
            </div>
            <aside className="relative overflow-hidden rounded-[16px] border border-line bg-surface p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-[11px] bg-ink text-sheet">
                  <LockKeyhole className="size-5" />
                </span>
                <h2 className="font-display text-[18px] leading-tight font-medium">La bóveda queda fuera de su alcance</h2>
              </div>
              <ul className="mt-4 flex flex-col gap-2.5 text-[13px] text-ink-2">
                <li className="flex gap-2.5">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" /> Ningún token puede leer la bóveda, ni siquiera cifrada: el servidor rechaza la petición antes de tocar los datos.
                </li>
                <li className="flex gap-2.5">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" /> Los agentes no pueden borrar: solo archivar, y tú puedes restaurar.
                </li>
                <li className="flex gap-2.5">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" /> Cada acción queda registrada y la ves en directo en la app.
                </li>
              </ul>
            </aside>
          </div>

          <section className="mt-12">
            <h2 className="mb-3 text-[11.5px] font-semibold tracking-[0.08em] text-ink-3 uppercase">Accesos activos</h2>
            {tokens.data && active.length === 0 ? (
              <button type="button" onClick={() => setCreateOpen(true)} className="flex w-full items-center gap-4 rounded-[16px] border border-dashed border-line-strong p-6 text-left transition-colors hover:border-agent/50 hover:bg-agent-soft/40">
                <span className="grid size-11 place-items-center rounded-[12px] bg-agent-soft text-agent">
                  <Bot className="size-5" />
                </span>
                <span>
                  <span className="block text-[14.5px] font-medium">Aún no has conectado ningún agente</span>
                  <span className="block text-[13px] text-ink-3">Crea un token y pega la configuración en Claude Code, Cursor, VS Code o Claude Desktop.</span>
                </span>
              </button>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {active.map((t) => (
                  <TokenCard key={t.id} token={t} onRevoke={() => void revoke(t)} onShowActivity={() => setTokenFilter(t.id)} />
                ))}
              </div>
            )}
            {inactive.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-[12.5px] text-ink-3 hover:text-ink">{inactive.length} revocados o caducados</summary>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {inactive.map((t) => (
                    <TokenCard key={t.id} token={t} inactive onShowActivity={() => setTokenFilter(t.id)} />
                  ))}
                </div>
              </details>
            )}
          </section>

          <section className="mt-12 grid gap-8 lg:grid-cols-[1.3fr_1fr]">
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[11.5px] font-semibold tracking-[0.08em] text-ink-3 uppercase">
                  Actividad {tokenFilter ? `de «${tokens.data?.find((t) => t.id === tokenFilter)?.name ?? ''}»` : 'de los agentes'}
                </h2>
                {tokenFilter && (
                  <button type="button" onClick={() => setTokenFilter(undefined)} className="text-[12px] font-medium text-ink-3 hover:text-ink">
                    Ver todos
                  </button>
                )}
              </div>
              <div className="rounded-[16px] border border-line bg-surface p-4 shadow-sm">
                {activity.data?.length ? (
                  <ActivityList items={activity.data} workspaceId={workspaceId} />
                ) : (
                  <p className="py-8 text-center text-[13px] text-ink-3">{activity.isPending ? 'Cargando…' : 'Cuando un agente trabaje en este espacio, lo verás aquí.'}</p>
                )}
              </div>
            </div>
            <div>
              <h2 className="mb-3 text-[11.5px] font-semibold tracking-[0.08em] text-ink-3 uppercase">Herramientas MCP</h2>
              <ul className="overflow-hidden rounded-[16px] border border-line bg-surface shadow-sm">
                {TOOLS.map((t) => (
                  <li key={t.name} className="border-b border-line px-4 py-2.5 last:border-b-0">
                    <p className="font-mono text-[11.5px] text-ink [overflow-wrap:anywhere]">{t.name}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-3">
                      <span className="font-medium text-agent">{t.scope}</span>· {t.description}
                    </p>
                  </li>
                ))}
              </ul>
              <p className="mt-2 px-1 text-[12px] text-ink-3">Cada agente solo ve las herramientas que sus permisos permiten.</p>
            </div>
          </section>
        </div>
      </div>
      <CreateTokenDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}

function TokenCard({ token, onRevoke, onShowActivity, inactive }: { token: TokenDTO; onRevoke?: () => void; onShowActivity: () => void; inactive?: boolean }) {
  const tasks = levelFromScopes(token.scopes, 'tasks')
  const docs = levelFromScopes(token.scopes, 'docs')
  return (
    <article className={cn('rounded-[16px] border border-line bg-surface p-4 shadow-sm', inactive && 'opacity-60')}>
      <div className="flex items-start gap-3">
        <Avatar name={token.name} kind="agent" size={36} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14.5px] font-semibold">{token.name}</h3>
          {token.oauth ? (
            <p className="truncate text-[11.5px] text-ink-3">Conectado con OAuth · vuelve a {destination(token.oauth.redirectUri).label}</p>
          ) : (
            <p className="font-mono text-[11.5px] text-ink-3">{token.prefix}…</p>
          )}
        </div>
        {onRevoke && (
          <Button variant="ghost" size="xs" icon={<TrashIcon />} onClick={onRevoke} className="hover:text-danger">
            Revocar
          </Button>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <ScopePill label="Tareas" level={tasks} />
        <ScopePill label="Documentos" level={docs} />
        <span className="inline-flex h-6 items-center gap-1 rounded-full bg-sunken px-2 text-[11.5px] text-ink-3">
          <LockKeyhole className="size-3" /> Bóveda: nunca
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-[11.5px]">
        <div>
          <dt className="text-ink-3">Último uso</dt>
          <dd className="text-ink-2">{token.lastUsedAt ? relativeTime(token.lastUsedAt) : 'Nunca'}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Creado</dt>
          <dd className="text-ink-2">{shortDate(token.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-ink-3">{token.revokedAt ? 'Revocado' : token.oauth ? 'Caduca si no se usa' : 'Caduca'}</dt>
          <dd className="text-ink-2">{token.revokedAt ? shortDate(token.revokedAt) : token.expiresAt ? shortDate(token.expiresAt) : 'Nunca'}</dd>
        </div>
      </dl>
      <button type="button" onClick={onShowActivity} className="mt-3 text-[12px] font-medium text-agent hover:underline">
        Ver su actividad
      </button>
    </article>
  )
}

function ScopePill({ label, level }: { label: string; level: 'none' | 'read' | 'write' }) {
  return (
    <span className={cn('inline-flex h-6 items-center rounded-full px-2 text-[11.5px] font-medium', level === 'none' ? 'bg-sunken text-ink-3' : level === 'read' ? 'bg-agent-soft text-agent' : 'bg-agent text-agent-ink')}>
      {label}: {LEVEL_LABEL[level]}
    </span>
  )
}
