import type { VaultStateDTO } from '@orqevio/shared'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, Bot, Check, FileText, FolderPlus, LockKeyhole, SquareKanban, X } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { ActivityList } from '../../components/ActivityList'
import { get } from '../../lib/api'
import { cn } from '../../lib/cn'
import { greeting, longDate, relativeTime } from '../../lib/format'
import { keys, useHome, useTokens } from '../../lib/queries'
import { localPref, setLocalPref } from '../../lib/theme'
import { DueChip } from '../boards/CardItem'
import { PageHeader } from '../shell/PageHeader'
import { useWorkspace } from '../shell/workspace'

export function HomePage() {
  const { t } = useTranslation('home')
  const { workspaceId, me, overview, openNewProject } = useWorkspace()
  const home = useHome(workspaceId)
  const tokens = useTokens()
  const vault = useQuery({ queryKey: keys.vault, queryFn: ({ signal }) => get<VaultStateDTO>('/vault', signal) })
  const [dismissed, setDismissed] = useState(() => localPref('onboarding-dismissed', false))
  const firstName = me.user.name.split(/\s+/)[0]
  const base = `/w/${workspaceId}`

  const projects = overview?.projects ?? []
  const steps = [
    { done: projects.length > 0, title: t('onboarding.project.title'), body: t('onboarding.project.body'), icon: <FolderPlus />, action: openNewProject },
    { done: projects.some((p) => p.pages.length > 0), title: t('onboarding.page.title'), body: t('onboarding.page.body'), icon: <FileText />, to: projects[0] ? `${base}/p/${projects[0].id}` : undefined },
    { done: Boolean(vault.data?.initialized), title: t('onboarding.vault.title'), body: t('onboarding.vault.body'), icon: <LockKeyhole />, to: `${base}/vault` },
    { done: (tokens.data?.length ?? 0) > 0, title: t('onboarding.agent.title'), body: t('onboarding.agent.body'), icon: <Bot />, to: `${base}/agents` },
  ]
  const ready = overview && tokens.data && vault.data
  const showSteps = ready && !dismissed && steps.some((s) => !s.done)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader crumbs={[{ label: t('title') }]} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1080px] px-6 py-10 sm:px-10 sm:py-14">
          <p className="animate-rise font-mono text-[11.5px] tracking-[0.14em] text-ink-3 uppercase first-letter:uppercase">{longDate()}</p>
          <h1 className="animate-rise mt-2 font-display text-[40px] leading-[1.05] font-medium tracking-[-0.03em] sm:text-[48px]" style={{ animationDelay: '40ms' }}>
            <Trans t={t} i18nKey="greeting" values={{ greeting: greeting(), name: firstName }} components={{ name: <span className="italic" /> }} />
          </h1>

          {showSteps && (
            <section className="animate-rise relative mt-10 rounded-[18px] border border-line bg-surface p-5 shadow-sm" style={{ animationDelay: '80ms' }} aria-label={t('onboarding.title')}>
              <button
                type="button"
                onClick={() => {
                  setDismissed(true)
                  setLocalPref('onboarding-dismissed', true)
                }}
                aria-label={t('onboarding.dismiss')}
                className="absolute top-3 right-3 grid size-7 place-items-center rounded-[8px] text-ink-3 hover:bg-hover hover:text-ink"
              >
                <X className="size-4" />
              </button>
              <h2 className="font-display text-[19px] font-medium">{t('onboarding.title')}</h2>
              <p className="mt-0.5 text-[13px] text-ink-3">{t('onboarding.progress', { done: steps.filter((s) => s.done).length, total: steps.length })}</p>
              <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {steps.map((s, i) => {
                  const inner = (
                    <>
                      <span className={cn('grid size-8 shrink-0 place-items-center rounded-[9px] [&_svg]:size-4', s.done ? 'bg-ok/12 text-ok' : 'bg-sunken text-ink-2')}>{s.done ? <Check /> : s.icon}</span>
                      <span className="min-w-0">
                        <span className={cn('block text-[13.5px] font-medium', s.done && 'text-ink-3 line-through decoration-ink-4')}>
                          <span className="mr-1 font-mono text-[11px] text-ink-3">{i + 1}</span>
                          {s.title}
                        </span>
                        <span className="block text-[12px] text-ink-3">{s.body}</span>
                      </span>
                    </>
                  )
                  const cls = 'flex h-full items-start gap-3 rounded-[12px] border border-line p-3 text-left transition-colors hover:border-line-strong hover:bg-hover'
                  return (
                    <li key={s.title}>
                      {s.to ? (
                        <Link to={s.to} className={cls}>
                          {inner}
                        </Link>
                      ) : (
                        <button type="button" onClick={s.action} className={cn(cls, 'w-full')}>
                          {inner}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ol>
            </section>
          )}

          <div className="mt-10 grid gap-6 lg:grid-cols-[1.25fr_1fr]">
            <Panel title={t('due.title')} delay={120} empty={home.data && home.data.dueCards.length === 0 ? t('due.empty') : null}>
              <ul className="flex flex-col">
                {home.data?.dueCards.map((c) => (
                  <li key={c.id}>
                    <Link to={`${base}/b/${c.boardId}?card=${c.id}`} className="flex items-center gap-3 rounded-[10px] px-2.5 py-2 transition-colors hover:bg-hover">
                      <SquareKanban className="size-4 shrink-0 text-ink-3" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium">{c.title}</span>
                        <span className="block truncate text-[12px] text-ink-3">
                          {c.projectName} · {c.boardName} · {c.columnName}
                        </span>
                      </span>
                      {c.dueAt && <DueChip dueAt={c.dueAt} />}
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title={t('recent.title')} delay={160} empty={home.data && home.data.recentPages.length === 0 ? t('recent.empty') : null}>
              <ul className="flex flex-col">
                {home.data?.recentPages.map((p) => (
                  <li key={p.id}>
                    <Link to={`${base}/d/${p.id}`} className="flex items-center gap-3 rounded-[10px] px-2.5 py-2 transition-colors hover:bg-hover">
                      <span className="w-4 text-center text-[14px]">{p.icon ?? <FileText className="size-4 text-ink-3" />}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium">{p.title || t('untitled', { ns: 'common' })}</span>
                        <span className="block truncate text-[12px] text-ink-3">{p.projectName}</span>
                      </span>
                      <span className="shrink-0 text-[11.5px] text-ink-3">{relativeTime(p.updatedAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>

          <div className="mt-6">
            <Panel
              title={t('activity.title')}
              delay={200}
              action={
                <Link to={`${base}/agents`} className="inline-flex items-center gap-1 text-[12px] font-medium text-ink-3 hover:text-ink">
                  {t('activity.agents')} <ArrowUpRight className="size-3.5" />
                </Link>
              }
              empty={home.data && home.data.activity.length === 0 ? t('activity.empty') : null}
            >
              {home.data && home.data.activity.length > 0 && (
                <div className="px-2.5 py-1">
                  <ActivityList items={home.data.activity} workspaceId={workspaceId} />
                </div>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </div>
  )
}

function Panel({ title, children, empty, delay = 0, action }: { title: string; children: ReactNode; empty?: string | null; delay?: number; action?: ReactNode }) {
  return (
    <section className="animate-rise flex flex-col" style={{ animationDelay: `${delay}ms` }}>
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-[11.5px] font-semibold tracking-[0.08em] text-ink-3 uppercase">{title}</h2>
        {action}
      </div>
      <div className="min-h-[120px] flex-1 rounded-[16px] border border-line bg-surface p-1.5 shadow-sm">
        {empty ? <p className="px-3 py-8 text-center text-[13px] text-ink-3">{empty}</p> : children}
      </div>
    </section>
  )
}
