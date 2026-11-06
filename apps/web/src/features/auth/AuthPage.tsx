import { loginInput, registerInput } from '@orqevio/shared'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, Eye, EyeOff } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { LogoMark, Wordmark } from '../../components/Logo'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { errorMessage, post } from '../../lib/api'
import { keys, useMe } from '../../lib/queries'
import { OrbitIllustration } from './OrbitIllustration'

const PILLARS = [
  { title: 'Tareas', body: 'Tableros Kanban, etiquetas, fechas y checklists.' },
  { title: 'Documentación', body: 'Páginas jerárquicas en Markdown, enlazadas con tus tareas.' },
  { title: 'Bóveda', body: 'Cifrado de extremo a extremo. Ni el servidor ni tus agentes la leen.' },
  { title: 'Agentes', body: 'Servidor MCP con permisos por token, para trabajar con tus LLM.' },
]

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const me = useMe()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const isRegister = mode === 'register'

  if (me.data) return <Navigate to={params.get('next') ?? '/'} replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const parsed = (isRegister ? registerInput : loginInput).safeParse({ name, email, password })
    if (!parsed.success) {
      const errs: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0])
        errs[key] ??=
          key === 'email'
            ? 'Introduce un correo válido.'
            : key === 'password'
              ? isRegister
                ? 'Usa al menos 10 caracteres.'
                : 'Introduce tu contraseña.'
              : 'Este campo es obligatorio.'
      }
      setFieldErrors(errs)
      return
    }
    setFieldErrors({})
    setBusy(true)
    try {
      await post(isRegister ? '/auth/register' : '/auth/login', parsed.data)
      await queryClient.invalidateQueries({ queryKey: keys.me })
      navigate(params.get('next') ?? '/', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

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
                <span className="font-mono text-[11px] text-ink-4">0{i + 1}</span>
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
          <h2 className="font-display text-[30px] leading-tight font-medium tracking-[-0.02em]">
            {isRegister ? 'Crea tu espacio' : 'Bienvenido de nuevo'}
          </h2>
          <p className="mt-2 text-[14px] text-ink-2">
            {isRegister ? 'Empieza en menos de un minuto. Sin tarjeta, sin plantillas de relleno.' : 'Inicia sesión para continuar donde lo dejaste.'}
          </p>
          <form onSubmit={submit} className="mt-8 flex flex-col gap-4" noValidate>
            {isRegister && (
              <Field label="Nombre" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={fieldErrors.name} autoFocus />
            )}
            <Field
              label="Correo electrónico"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={fieldErrors.email}
              autoFocus={!isRegister}
            />
            <Field
              label="Contraseña"
              type={show ? 'text' : 'password'}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={fieldErrors.password}
              hint={isRegister ? 'Mínimo 10 caracteres. Es tu contraseña de acceso, distinta de la de la bóveda.' : undefined}
              trailing={
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="grid size-8 place-items-center rounded-[8px] text-ink-3 hover:bg-hover hover:text-ink"
                  aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              }
            />
            {error && (
              <p role="alert" className="rounded-[10px] bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" size="lg" loading={busy} className="mt-2 w-full">
              {isRegister ? 'Crear cuenta' : 'Iniciar sesión'}
            </Button>
          </form>
          <p className="mt-6 text-center text-[13.5px] text-ink-2">
            {isRegister ? '¿Ya tienes cuenta?' : '¿Aún no tienes cuenta?'}{' '}
            <Link to={isRegister ? '/login' : '/register'} className="inline-flex items-center gap-0.5 font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-accent">
              {isRegister ? 'Inicia sesión' : 'Crea una'}
              <ArrowUpRight className="size-3.5" />
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}
