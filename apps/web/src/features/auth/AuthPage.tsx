import type { AnonymousSessionDTO, MeDTO, RecoveryReason } from '@orqevio/shared'
import { claimInput, recoverInput, unlockInput } from '@orqevio/shared'
import { useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { LogoMark, Wordmark } from '../../components/Logo'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { applyLocale, currentLocale } from '../../i18n'
import { LanguageSelect } from '../../i18n/LanguageSelect'
import { errorMessage, post } from '../../lib/api'
import { cn } from '../../lib/cn'
import { keys, useAccessState, useTokens } from '../../lib/queries'
import { TokenCard, useRevokeToken } from '../agents/TokenCard'
import { FullScreenLoader } from '../shell/States'
import { AccessKeyReveal } from './AccessKeyReveal'
import { OrbitIllustration } from './OrbitIllustration'

const PILLARS = ['tasks', 'docs', 'vault', 'agents'] as const

/** What whoever manages the copy runs to issue a new access key; a command, never translated. */
const RESET_ACCESS_COMMAND = 'docker compose exec app node dist/cli.js reset-access'

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  const { t } = useTranslation('auth')
  return (
    <div className="grid min-h-dvh bg-desk lg:grid-cols-[minmax(0,1.1fr)_minmax(440px,0.9fr)]">
      <aside className="grain relative hidden overflow-hidden border-r border-line lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div className="flex items-center gap-2.5">
          <LogoMark size={30} />
          <Wordmark />
        </div>
        <div className="grid items-center gap-10 xl:grid-cols-[1fr_minmax(0,380px)]">
          <div className="animate-rise">
            <h1 className="font-display text-[52px] leading-[1.02] font-medium tracking-[-0.03em] xl:text-[62px]">
              <Trans t={t} i18nKey="hero.title" components={{ br: <br />, accent: <span className="italic text-accent" /> }} />
            </h1>
            <p className="mt-6 max-w-[440px] text-[16px] leading-relaxed text-ink-2">{t('hero.body')}</p>
          </div>
          <div className="hidden xl:block">
            <OrbitIllustration />
          </div>
        </div>
        <ul className="grid max-w-[720px] grid-cols-2 gap-x-10 gap-y-5">
          {PILLARS.map((p, i) => (
            <li key={p} className="animate-rise" style={{ animationDelay: `${120 + i * 60}ms` }}>
              <p className="flex items-center gap-2 text-[13px] font-semibold">
                <span className="font-mono text-[11px] text-ink-3">0{i + 1}</span>
                {t(`pillars.${p}.title`)}
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{t(`pillars.${p}.body`)}</p>
            </li>
          ))}
        </ul>
      </aside>


      <main className="flex flex-col items-center justify-center bg-sheet px-6 py-12 sm:px-10">
        <div className="mb-10 flex items-center gap-2.5 lg:hidden">
          <LogoMark size={30} />
          <Wordmark />
        </div>
        <div className="animate-rise w-full max-w-[380px]">
          <h2 className="font-display text-[30px] leading-tight font-medium tracking-[-0.02em]">{title}</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
        {/* The language the copy is claimed in becomes its owner's. */}
        <LanguageSelect compact className="mt-12" onChange={(locale) => void applyLocale(locale)} />
      </main>
    </div>
  )
}

function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-[10px] bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
      {children}
    </p>
  )
}

function SecretField({ field, value, onChange, error, autoComplete, autoFocus, hint }: {
  field: 'setupCode' | 'newSetupCode' | 'accessKey'
  value: string
  onChange: (value: string) => void
  error?: string
  autoComplete: string
  autoFocus?: boolean
  hint?: ReactNode
}) {
  const { t } = useTranslation('auth')
  const [show, setShow] = useState(false)
  return (
    <Field
      label={t(`fields.${field}.label`)}
      type={show ? 'text' : 'password'}
      autoComplete={autoComplete}
      spellCheck={false}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={error}
      hint={hint}
      autoFocus={autoFocus}
      className="[&_input]:font-mono"
      trailing={
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="grid size-8 place-items-center rounded-[8px] text-ink-3 hover:bg-hover hover:text-ink"
          aria-label={show ? t(`fields.${field}.hide`) : t(`fields.${field}.show`)}
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      }
    />
  )
}

type Session = MeDTO | AnonymousSessionDTO

/**
 * Sign-in screens of a copy of Orqevio. There is no registration: the first
 * visit claims the copy with the setup code and reveals the access key once;
 * afterwards the access key is all that is needed on each device.
 */
export function AuthPage({ mode }: { mode: 'login' | 'setup' }) {
  const { t } = useTranslation('auth')
  const access = useAccessState()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const queryClient = useQueryClient()
  const [revealed, setRevealed] = useState<{ accessKey: string; kind: 'setup' | 'recovery'; reason?: RecoveryReason } | null>(null)
  const next = params.get('next') ?? '/'

  async function enter() {
    await queryClient.invalidateQueries({ queryKey: keys.me })
    await queryClient.invalidateQueries({ queryKey: keys.access })
    navigate(next, { replace: true })
  }

  if (revealed) {
    return (
      <AuthLayout title={t(`revealed.${revealed.kind}.title`)} subtitle={t(`revealed.${revealed.kind}.subtitle`)}>
        <AccessKeyReveal accessKey={revealed.accessKey} confirmLabel={t('revealed.continue')} onDone={() => void enter()}>
          {revealed.reason && <RecoveredAgents reason={revealed.reason} />}
        </AccessKeyReveal>
      </AuthLayout>
    )
  }

  // Decide from a fresh answer: a cached one may predate a session revoked on another device.
  if (!access.isFetchedAfterMount) return <FullScreenLoader />
  const session = access.data as Session | undefined
  if (session?.user) return <Navigate to={next} replace />
  const claimed = session ? session.claimed : true
  const query = params.toString() ? `?${params.toString()}` : ''
  if (mode === 'login' && !claimed) return <Navigate to={`/setup${query}`} replace />
  if (mode === 'setup' && claimed) return <Navigate to={`/login${query}`} replace />

  return mode === 'setup' ? (
    <SetupForm onClaimed={(accessKey) => setRevealed({ accessKey, kind: 'setup' })} />
  ) : (
    <LoginForm
      recoverable={Boolean(session && !session.user && session.recoverable)}
      onSignedIn={() => void enter()}
      onRecovered={(accessKey, reason) => setRevealed({ accessKey, kind: 'recovery', reason })}
    />
  )
}

function SetupForm({ onClaimed }: { onClaimed: (accessKey: string) => void }) {
  const { t } = useTranslation('auth')
  const [setupCode, setSetupCode] = useState('')
  const [name, setName] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const parsed = claimInput.safeParse({ setupCode, name, locale: currentLocale() })
    if (!parsed.success) {
      const errs: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0])
        errs[key] ??= key === 'setupCode' ? t('setup.missingSetupCode') : t('setup.missingName')
      }
      setFieldErrors(errs)
      return
    }
    setFieldErrors({})
    setBusy(true)
    try {
      const res = await post<{ accessKey: string }>('/auth/claim', parsed.data)
      onClaimed(res.accessKey)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title={t('setup.title')} subtitle={t('setup.subtitle')}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <SecretField field="setupCode" value={setupCode} onChange={setSetupCode} error={fieldErrors.setupCode} autoComplete="off" autoFocus />
        <Field label={t('fields.name.label')} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={fieldErrors.name} hint={t('fields.name.hint')} maxLength={80} />
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button type="submit" variant="primary" size="lg" loading={busy} className="mt-2 w-full">
          {t('setup.submit')}
        </Button>
      </form>
    </AuthLayout>
  )
}

function LoginForm({ recoverable, onSignedIn, onRecovered }: { recoverable: boolean; onSignedIn: () => void; onRecovered: (accessKey: string, reason: RecoveryReason) => void }) {
  const { t } = useTranslation('auth')
  const [accessKey, setAccessKey] = useState('')
  const [fieldError, setFieldError] = useState<string | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [lost, setLost] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const parsed = unlockInput.safeParse({ accessKey })
    if (!parsed.success) {
      setFieldError(t('login.missingAccessKey'))
      return
    }
    setFieldError(undefined)
    setBusy(true)
    try {
      await post('/auth/login', parsed.data)
      onSignedIn()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title={t('login.title')} subtitle={t('login.subtitle')}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <SecretField field="accessKey" value={accessKey} onChange={setAccessKey} error={fieldError} autoComplete="current-password" autoFocus />
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button type="submit" variant="primary" size="lg" loading={busy} className="mt-2 w-full">
          {t('login.submit')}
        </Button>
      </form>
      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={() => setLost((v) => !v)}
          aria-expanded={lost}
          className="text-[13.5px] font-medium text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink hover:decoration-accent"
        >
          {t('login.lostKey')}
        </button>
      </div>
      {lost && <RecoveryPanel recoverable={recoverable} onRecovered={onRecovered} />}
    </AuthLayout>
  )
}

function RecoveryPanel({ recoverable, onRecovered }: { recoverable: boolean; onRecovered: (accessKey: string, reason: RecoveryReason) => void }) {
  const { t } = useTranslation('auth')
  const [setupCode, setSetupCode] = useState('')
  // No answer is chosen for the person: a stolen key needs the agents disconnected.
  const [reason, setReason] = useState<RecoveryReason | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!setupCode.trim()) {
      setError(t('recovery.missingSetupCode'))
      return
    }
    const parsed = recoverInput.safeParse({ setupCode, reason })
    if (!parsed.success) {
      setError(t('recovery.missingReason'))
      return
    }
    setBusy(true)
    try {
      const res = await post<{ accessKey: string }>('/auth/recover', parsed.data)
      onRecovered(res.accessKey, parsed.data.reason)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 rounded-[14px] border border-line bg-sunken p-4 text-[13px] leading-relaxed text-ink-2">
      <p>{t('recovery.intro')}</p>
      <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5">
        <li>
          {t('recovery.withDocker')}
          <code className="mt-1 block rounded-[8px] border border-line bg-sheet px-2.5 py-1.5 font-mono text-[12px] break-words text-ink">{RESET_ACCESS_COMMAND}</code>
        </li>
        <li>
          <Trans t={t} i18nKey="recovery.withNewCode" components={{ code: <code className="font-mono text-[12px] text-ink" /> }} />
        </li>
      </ul>
      <p className="mt-2">{t('recovery.vaultUnaffected')}</p>
      {recoverable && (
        <form onSubmit={submit} className="mt-4 flex flex-col gap-3" noValidate>
          <SecretField field="newSetupCode" value={setupCode} onChange={setSetupCode} autoComplete="off" />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[13px] font-medium text-ink">{t('recovery.reason.legend')}</legend>
            {(['lost', 'compromised'] as const).map((option) => (
              <label key={option} className={cn('flex cursor-pointer items-start gap-3 rounded-[10px] border bg-sheet px-3 py-2.5', reason === option ? 'border-accent' : 'border-line')}>
                <input type="radio" name="recovery-reason" value={option} checked={reason === option} onChange={() => setReason(option)} className="mt-1 size-4 accent-[var(--accent)]" />
                <span>
                  <span className="block text-[13px] font-medium text-ink">{t(`recovery.reason.${option}.label`)}</span>
                  <span className="block text-[12.5px] text-ink-3">{t(`recovery.reason.${option}.hint`)}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" variant="primary" loading={busy}>
            {t('recovery.submit')}
          </Button>
        </form>
      )}
    </div>
  )
}

/** After recovering: the agents that kept their access, to spot one that isn't yours, or that they were all disconnected. */
function RecoveredAgents({ reason }: { reason: RecoveryReason }) {
  const { t } = useTranslation('auth')
  const tokens = useTokens()
  const revoke = useRevokeToken()
  if (reason === 'compromised') return <p className="mt-4 rounded-[12px] border border-line bg-sunken px-3.5 py-3 text-[13px] text-ink-2">{t('revealed.agents.revoked')}</p>
  const active = (tokens.data ?? []).filter((token) => !token.revokedAt && (!token.expiresAt || new Date(token.expiresAt) > new Date()))
  return (
    <section className="mt-4" aria-labelledby="recovered-agents">
      <h2 id="recovered-agents" className="text-[13px] font-medium text-ink">
        {t('revealed.agents.title')}
      </h2>
      {tokens.data && active.length === 0 ? (
        <p className="mt-1 text-[12.5px] text-ink-3">{t('revealed.agents.none')}</p>
      ) : (
        <>
          <p className="mt-1 text-[12.5px] text-ink-3">{t('revealed.agents.review')}</p>
          <div className="mt-2 flex max-h-[320px] flex-col gap-2 overflow-y-auto">
            {active.map((token) => (
              <TokenCard key={token.id} token={token} onRevoke={() => void revoke(token)} />
            ))}
          </div>
        </>
      )}
    </section>
  )
}
