import type { AnonymousSessionDTO, MeDTO } from '@orqevio/shared'
import { claimInput, recoverInput, unlockInput } from '@orqevio/shared'
import { useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { LogoMark, Wordmark } from '../../components/Logo'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { errorMessage, post } from '../../lib/api'
import { keys, useAccessState } from '../../lib/queries'
import { FullScreenLoader } from '../shell/States'
import { AccessKeyReveal } from './AccessKeyReveal'
import { OrbitIllustration } from './OrbitIllustration'

const PILLARS = [
  { title: 'Tareas', body: 'Tableros Kanban, etiquetas, fechas y checklists.' },
  { title: 'Documentación', body: 'Páginas jerárquicas en Markdown, enlazadas con tus tareas.' },
  { title: 'Bóveda', body: 'Cifrado de extremo a extremo. Ni el servidor ni tus agentes la leen.' },
  { title: 'Agentes', body: 'Servidor MCP con permisos por token, para trabajar con tus LLM.' },
]

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
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
              Organiza.
              <br />
              Documenta.
              <br />
              <span className="italic text-accent">Protege.</span>
            </h1>
            <p className="mt-6 max-w-[440px] text-[16px] leading-relaxed text-ink-2">
              Un espacio de trabajo para tus proyectos, tu conocimiento y tus credenciales. Accesible para ti y tus agentes de IA, con permisos controlados.
            </p>
          </div>
          <div className="hidden xl:block">
            <OrbitIllustration />
          </div>
        </div>
        <ul className="grid max-w-[720px] grid-cols-2 gap-x-10 gap-y-5">
          {PILLARS.map((p, i) => (
            <li key={p.title} className="animate-rise" style={{ animationDelay: `${120 + i * 60}ms` }}>
              <p className="flex items-center gap-2 text-[13px] font-semibold">
                <span className="font-mono text-[11px] text-ink-3">0{i + 1}</span>
                {p.title}
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{p.body}</p>
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

function SecretField({ label, value, onChange, error, autoComplete, autoFocus, hint }: {
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  autoComplete: string
  autoFocus?: boolean
  hint?: ReactNode
}) {
  const [show, setShow] = useState(false)
  return (
    <Field
      label={label}
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
          aria-label={show ? `Ocultar ${label.toLowerCase()}` : `Mostrar ${label.toLowerCase()}`}
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
  const access = useAccessState()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const queryClient = useQueryClient()
  const [revealed, setRevealed] = useState<{ accessKey: string; kind: 'setup' | 'recovery' } | null>(null)
  const next = params.get('next') ?? '/'

  async function enter() {
    await queryClient.invalidateQueries({ queryKey: keys.me })
    await queryClient.invalidateQueries({ queryKey: keys.access })
    navigate(next, { replace: true })
  }

  if (revealed) {
    return (
      <AuthLayout
        title={revealed.kind === 'setup' ? 'Guarda tu clave de acceso' : 'Tu nueva clave de acceso'}
        subtitle={
          revealed.kind === 'setup'
            ? 'Es lo que usarás para entrar en esta copia desde cualquier dispositivo. Se muestra una sola vez: guárdala en tu gestor de contraseñas.'
            : 'La anterior ya no sirve y se han cerrado todas las sesiones. Guárdala en tu gestor de contraseñas: se muestra una sola vez.'
        }
      >
        <AccessKeyReveal accessKey={revealed.accessKey} confirmLabel="Entrar en Orqevio" onDone={() => void enter()} />
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
      onRecovered={(accessKey) => setRevealed({ accessKey, kind: 'recovery' })}
    />
  )
}

function SetupForm({ onClaimed }: { onClaimed: (accessKey: string) => void }) {
  const [setupCode, setSetupCode] = useState('')
  const [name, setName] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const parsed = claimInput.safeParse({ setupCode, name })
    if (!parsed.success) {
      const errs: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0])
        errs[key] ??= key === 'setupCode' ? 'Introduce el código de configuración.' : 'Escribe tu nombre.'
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
    <AuthLayout
      title="Configura tu copia"
      subtitle="Esta copia de Orqevio es solo tuya. Introduce el código de configuración que definiste al instalarla; si no definiste ninguno, aparece en el registro del servidor."
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <SecretField label="Código de configuración" value={setupCode} onChange={setSetupCode} error={fieldErrors.setupCode} autoComplete="off" autoFocus />
        <Field label="Tu nombre" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={fieldErrors.name} hint="Aparece en la actividad de tus espacios." maxLength={80} />
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button type="submit" variant="primary" size="lg" loading={busy} className="mt-2 w-full">
          Configurar
        </Button>
      </form>
    </AuthLayout>
  )
}

function LoginForm({ recoverable, onSignedIn, onRecovered }: { recoverable: boolean; onSignedIn: () => void; onRecovered: (accessKey: string) => void }) {
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
      setFieldError('Introduce tu clave de acceso.')
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
    <AuthLayout title="Hola de nuevo" subtitle="Introduce la clave de acceso de esta copia de Orqevio.">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <SecretField label="Clave de acceso" value={accessKey} onChange={setAccessKey} error={fieldError} autoComplete="current-password" autoFocus />
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button type="submit" variant="primary" size="lg" loading={busy} className="mt-2 w-full">
          Entrar
        </Button>
      </form>
      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={() => setLost((v) => !v)}
          aria-expanded={lost}
          className="text-[13.5px] font-medium text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink hover:decoration-accent"
        >
          ¿Has perdido la clave?
        </button>
      </div>
      {lost && <RecoveryPanel recoverable={recoverable} onRecovered={onRecovered} />}
    </AuthLayout>
  )
}

function RecoveryPanel({ recoverable, onRecovered }: { recoverable: boolean; onRecovered: (accessKey: string) => void }) {
  const [setupCode, setSetupCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const parsed = recoverInput.safeParse({ setupCode })
    if (!parsed.success) {
      setError('Introduce el nuevo código de configuración.')
      return
    }
    setBusy(true)
    try {
      const res = await post<{ accessKey: string }>('/auth/recover', parsed.data)
      onRecovered(res.accessKey)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 rounded-[14px] border border-line bg-sunken p-4 text-[13px] leading-relaxed text-ink-2">
      <p>Quien administra esta copia puede generar una clave nueva:</p>
      <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5">
        <li>
          Con Docker:
          <code className="mt-1 block rounded-[8px] border border-line bg-sheet px-2.5 py-1.5 font-mono text-[12px] break-words text-ink">
            docker compose exec app node dist/cli.js reset-access
          </code>
        </li>
        <li>
          Con un código nuevo: cambia <code className="font-mono text-[12px] text-ink">SETUP_CODE</code> en la configuración de la copia, reiníciala e introdúcelo aquí.
        </li>
      </ul>
      <p className="mt-2">La bóveda no se ve afectada: sigue protegida por su contraseña maestra.</p>
      {recoverable && (
        <form onSubmit={submit} className="mt-4 flex flex-col gap-3" noValidate>
          <SecretField label="Nuevo código de configuración" value={setupCode} onChange={setSetupCode} autoComplete="off" />
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" variant="primary" loading={busy}>
            Recuperar el acceso
          </Button>
        </form>
      )}
    </div>
  )
}
