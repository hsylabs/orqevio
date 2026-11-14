import { Bot, LockKeyhole, Plus, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityList } from '../../components/ActivityList'
import { Button } from '../../components/ui/Button'
import { CopyButton } from '../../components/ui/CopyButton'
import { useActivity, useTokens } from '../../lib/queries'
import { PageHeader } from '../shell/PageHeader'
import { useWorkspace } from '../shell/workspace'
import { CreateTokenDialog } from './CreateTokenDialog'
import { mcpUrl } from './ConnectKit'
import { TokenCard, useRevokeToken } from './TokenCard'

/** The MCP tools, with the scope each needs; `id` names its description in the catalog. */
const TOOLS = [
  { id: 'listProjects', name: 'list_projects', scope: 'read' },
  { id: 'search', name: 'search', scope: 'read' },
  { id: 'readBoards', name: 'get_board · get_card', scope: 'tasksRead' },
  { id: 'editCards', name: 'create_card · update_card · move_card', scope: 'tasksWrite' },
  { id: 'archiveCard', name: 'archive_card', scope: 'tasksWrite' },
  { id: 'organizeBoards', name: 'create_board · create_column · update_column', scope: 'tasksWrite' },
  { id: 'labels', name: 'create_label · add_checklist_items · update_checklist_item', scope: 'tasksWrite' },
  { id: 'readPages', name: 'list_pages · read_page', scope: 'docsRead' },
  { id: 'writePages', name: 'create_page · update_page', scope: 'docsWrite' },
  { id: 'linkCard', name: 'link_card_to_page', scope: 'write' },
] as const

export function AgentsPage() {
  const { t } = useTranslation('agents')
  const { workspaceId } = useWorkspace()
  const tokens = useTokens()
  const [createOpen, setCreateOpen] = useState(false)
  const [tokenFilter, setTokenFilter] = useState<string | undefined>()
  const activity = useActivity(workspaceId, { agentsOnly: true, tokenId: tokenFilter })

  const active = (tokens.data ?? []).filter((token) => !token.revokedAt && (!token.expiresAt || new Date(token.expiresAt) > new Date()))
  const inactive = (tokens.data ?? []).filter((token) => !active.includes(token))

  const revoke = useRevokeToken()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumbs={[{ label: t('title') }]}
        actions={
          <Button variant="agent" size="sm" icon={<Plus />} onClick={() => setCreateOpen(true)}>
            {t('connect')}
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1080px] px-6 py-10 sm:px-10">
          <div className="animate-rise grid gap-6 lg:grid-cols-[1.3fr_1fr]">
            <div>
              <h1 className="font-display text-[34px] leading-tight font-medium tracking-[-0.02em]">{t('intro.title')}</h1>
              <p className="mt-2 max-w-[560px] text-[14px] leading-relaxed text-ink-2">{t('intro.body')}</p>
              <div className="mt-5 flex max-w-[560px] items-center gap-2 rounded-[12px] border border-line bg-surface py-1.5 pr-1.5 pl-3.5 shadow-sm">
                <span className="text-[11.5px] font-semibold tracking-[0.06em] text-ink-3 uppercase">{t('intro.endpoint')}</span>
                <code className="min-w-0 flex-1 truncate font-mono text-[13px]">{mcpUrl()}</code>
                <CopyButton value={mcpUrl()} label={t('intro.copyEndpoint')} message={t('intro.endpointCopied')} />
              </div>
              <p className="mt-3 max-w-[560px] text-[13px] leading-relaxed text-ink-3">{t('intro.oauth')}</p>
            </div>
            <aside className="relative overflow-hidden rounded-[16px] border border-line bg-surface p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-[11px] bg-ink text-sheet">
                  <LockKeyhole className="size-5" />
                </span>
                <h2 className="font-display text-[18px] leading-tight font-medium">{t('vault.title')}</h2>
              </div>
              <ul className="mt-4 flex flex-col gap-2.5 text-[13px] text-ink-2">
                <li className="flex gap-2.5">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" /> {t('vault.unreadable')}
                </li>
                <li className="flex gap-2.5">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" /> {t('vault.noDeletes')}
                </li>
                <li className="flex gap-2.5">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" /> {t('vault.logged')}
                </li>
              </ul>
            </aside>
          </div>

          <section className="mt-12">
            <h2 className="mb-3 text-[11.5px] font-semibold tracking-[0.08em] text-ink-3 uppercase">{t('tokens.active')}</h2>
            {tokens.data && active.length === 0 ? (
              <button type="button" onClick={() => setCreateOpen(true)} className="flex w-full items-center gap-4 rounded-[16px] border border-dashed border-line-strong p-6 text-left transition-colors hover:border-agent/50 hover:bg-agent-soft/40">
                <span className="grid size-11 place-items-center rounded-[12px] bg-agent-soft text-agent">
                  <Bot className="size-5" />
                </span>
                <span>
                  <span className="block text-[14.5px] font-medium">{t('tokens.emptyTitle')}</span>
                  <span className="block text-[13px] text-ink-3">{t('tokens.emptyBody')}</span>
                </span>
              </button>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {active.map((token) => (
                  <TokenCard key={token.id} token={token} onRevoke={() => void revoke(token)} onShowActivity={() => setTokenFilter(token.id)} />
                ))}
              </div>
            )}
            {inactive.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-[12.5px] text-ink-3 hover:text-ink">{t('tokens.inactive', { count: inactive.length })}</summary>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {inactive.map((token) => (
                    <TokenCard key={token.id} token={token} inactive onShowActivity={() => setTokenFilter(token.id)} />
                  ))}
                </div>
              </details>
            )}
          </section>

          <section className="mt-12 grid gap-8 lg:grid-cols-[1.3fr_1fr]">
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[11.5px] font-semibold tracking-[0.08em] text-ink-3 uppercase">
                  {tokenFilter ? t('activity.titleFor', { name: tokens.data?.find((token) => token.id === tokenFilter)?.name ?? '' }) : t('activity.title')}
                </h2>
                {tokenFilter && (
                  <button type="button" onClick={() => setTokenFilter(undefined)} className="text-[12px] font-medium text-ink-3 hover:text-ink">
                    {t('activity.showAll')}
                  </button>
                )}
              </div>
              <div className="rounded-[16px] border border-line bg-surface p-4 shadow-sm">
                {activity.data?.length ? (
                  <ActivityList items={activity.data} workspaceId={workspaceId} />
                ) : (
                  <p className="py-8 text-center text-[13px] text-ink-3">{activity.isPending ? t('activity.loading') : t('activity.empty')}</p>
                )}
              </div>
            </div>
            <div>
              <h2 className="mb-3 text-[11.5px] font-semibold tracking-[0.08em] text-ink-3 uppercase">{t('tools.title')}</h2>
              <ul className="overflow-hidden rounded-[16px] border border-line bg-surface shadow-sm">
                {TOOLS.map((tool) => (
                  <li key={tool.id} className="border-b border-line px-4 py-2.5 last:border-b-0">
                    <p className="font-mono text-[11.5px] text-ink [overflow-wrap:anywhere]">{tool.name}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-3">
                      <span className="font-medium text-agent">{t(`tools.scopes.${tool.scope}`)}</span>· {t(`tools.descriptions.${tool.id}`)}
                    </p>
                  </li>
                ))}
              </ul>
              <p className="mt-2 px-1 text-[12px] text-ink-3">{t('tools.footnote')}</p>
            </div>
          </section>
        </div>
      </div>
      <CreateTokenDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
