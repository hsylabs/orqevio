import type { AccessLevel, OAuthDecisionDTO, OAuthRequestDTO } from '@orqevio/shared'
import { levelFromScopes, scopesFromLevels } from '@orqevio/shared'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, ShieldAlert, ShieldCheck } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useLocation } from 'react-router'
import { LogoMark, Wordmark } from '../../components/Logo'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { errorMessage, post } from '../../lib/api'
import { relativeTime } from '../../lib/format'
import { useMe } from '../../lib/queries'
import { localPref } from '../../lib/theme'
import { AccessRows } from '../agents/AccessRows'
import { destination } from './destination'
import { FullScreenLoader } from '../shell/States'

function Layout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-sheet px-6 py-12 sm:px-10">
      <div className="mb-10 flex items-center gap-2.5">
        <LogoMark size={30} />
        <Wordmark />
      </div>
      <div className="animate-rise w-full max-w-[460px]">
        <h1 className="font-display text-[30px] leading-tight font-medium tracking-[-0.02em]">{title}</h1>
        {subtitle && <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{subtitle}</p>}
        <div className="mt-8">{children}</div>
      </div>
    </main>
  )
}

/**
 * OAuth consent screen (the authorization endpoint): an MCP client such as
 * Claude asks for access, and the owner chooses the workspace and permissions,
 * exactly as when creating a token.
 */
export function ConsentPage() {
  const { t } = useTranslation('oauth')
  const me = useMe()
  const location = useLocation()
  const params = useMemo(() => Object.fromEntries(new URLSearchParams(location.search)), [location.search])
  const request = useQuery({
    queryKey: ['oauth-request', location.search],
    queryFn: () => post<OAuthRequestDTO>('/oauth/request', { params }),
    enabled: Boolean(me.data?.user),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  })

  if (me.isPending) return <FullScreenLoader />
  if (me.isError || !me.data?.user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if (request.isPending) return <FullScreenLoader />
  if (request.isError) return <Problem message={errorMessage(request.error)} />
  const result = request.data
  if (result.kind === 'problem') return <Problem message={t(`problems.${result.problem}`)} detail={result.detail} />
  if (result.kind === 'redirect') return <Leaving to={result.redirect} />
  return <Consent params={params} request={result} workspaces={me.data.workspaces} />
}

function Problem({ message, detail }: { message: string; detail?: string }) {
  const { t } = useTranslation('oauth')
  return (
    <Layout title={t('problem.title')}>
      <p role="alert" className="rounded-[12px] bg-danger-soft px-3.5 py-3 text-[13.5px] leading-relaxed text-danger">
        {message}
      </p>
      {detail && <p className="mt-3 font-mono text-[11.5px] break-words text-ink-3">{detail}</p>}
      <a href="/" className="mt-6 inline-flex text-[13.5px] font-medium text-accent hover:underline">
        {t('problem.home')}
      </a>
    </Layout>
  )
}

function Leaving({ to }: { to: string }) {
  const { t } = useTranslation('oauth')
  const back = destination(to)
  useEffect(() => window.location.assign(to), [to])
  return (
    <Layout title={t('leaving.title')} subtitle={t(`leaving.subtitle.${back.kind}`, { name: back.name })}>
      <span />
    </Layout>
  )
}

function Consent({ params, request, workspaces }: { params: Record<string, string>; request: Extract<OAuthRequestDTO, { kind: 'consent' }>; workspaces: Array<{ id: string; name: string }> }) {
  const { t } = useTranslation(['oauth', 'agents', 'common'])
  const { client } = request
  const asked = request.scopes.length > 0
  const [tasks, setTasks] = useState<AccessLevel>(asked ? levelFromScopes(request.scopes, 'tasks') : 'write')
  const [docs, setDocs] = useState<AccessLevel>(asked ? levelFromScopes(request.scopes, 'docs') : 'read')
  const last = localPref<string | null>('workspace', null)
  const [workspaceId, setWorkspaceId] = useState(workspaces.find((w) => w.id === last)?.id ?? workspaces[0]?.id ?? '')
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [leaving, setLeaving] = useState<string | null>(null)
  const scopes = scopesFromLevels({ tasks, docs })
  const back = destination(client.redirectUri)
  // Reconnecting: the access this application already has here is replaced, unless it is another account of it.
  const [replace, setReplace] = useState(true)
  const previous = request.existing.filter((access) => access.workspaceId === workspaceId)
  const lastUsed = previous.map((access) => access.lastUsedAt).filter((when): when is string => when !== null).sort().at(-1)

  async function decide(allow: boolean) {
    setBusy(allow ? 'allow' : 'deny')
    setError(null)
    try {
      const { redirect } = await post<OAuthDecisionDTO>('/oauth/decision', { params, allow, workspaceId, scopes, replace: previous.length > 0 && replace })
      setLeaving(redirect)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(null)
    }
  }

  if (leaving) return <Leaving to={leaving} />
  return (
    <Layout title={t('consent.title', { name: client.name })} subtitle={t('consent.subtitle')}>
      <div className="flex flex-col gap-5">
        <section aria-label={t('consent.app')} className="rounded-[14px] border border-line bg-surface p-4">
          <div className="flex items-center gap-3">
            <Avatar name={client.name} kind="agent" size={36} />
            <div className="min-w-0">
              <p className="truncate text-[14.5px] font-semibold">{client.name}</p>
              <p className="text-[12px] text-ink-3">{t(`consent.returnsTo.${back.kind}`, { name: back.name })}</p>
            </div>
          </div>
          <p className="mt-3 flex gap-2 text-[12.5px] leading-relaxed text-ink-2">
            {client.publishedBy ? (
              <>
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" /> {t('consent.publishedBy', { publisher: client.publishedBy })}
              </>
            ) : (
              <>
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warn" /> {t('consent.unverified')}
              </>
            )}
          </p>
          {back.local && (
            <p className="mt-2 flex gap-2 text-[12.5px] leading-relaxed text-ink-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" /> {t('consent.local')}
            </p>
          )}
        </section>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-2">{t('consent.workspace')}</span>
          <select value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} className="field">
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>

        {previous.length > 0 && (
          <section className="rounded-[14px] border border-line bg-sunken p-4 text-[13px] leading-relaxed">
            <p className="text-ink-2">{lastUsed ? t('consent.existing', { name: client.name, when: relativeTime(lastUsed) }) : t('consent.existingUnused', { name: client.name })}</p>
            <label className="mt-3 flex cursor-pointer items-start gap-2.5">
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
              <span>
                <span className="block font-medium text-ink">{t('consent.replace')}</span>
                <span className="block text-[12.5px] text-ink-3">{t('consent.replaceHint', { name: client.name })}</span>
              </span>
            </label>
          </section>
        )}

        <AccessRows tasks={tasks} docs={docs} onTasks={setTasks} onDocs={setDocs} />
        {scopes.length === 0 && <p className="text-[12.5px] text-danger">{t('agents:access.atLeastOne')}</p>}
        {error && (
          <p role="alert" className="rounded-[10px] bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" loading={busy === 'deny'} disabled={busy !== null} onClick={() => void decide(false)}>
            {t('common:actions.cancel')}
          </Button>
          <Button variant="agent" icon={<ArrowRight />} loading={busy === 'allow'} disabled={busy !== null || scopes.length === 0 || !workspaceId} onClick={() => void decide(true)}>
            {t('consent.allow')}
          </Button>
        </div>
        <p className="text-[12px] text-ink-3">{t('consent.revokeLater')}</p>
      </div>
    </Layout>
  )
}
