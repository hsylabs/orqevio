import type { VaultItemRecordDTO, VaultStateDTO } from '@orqevio/shared'
import { Check, Copy, Download, Eye, EyeOff, KeyRound, ShieldCheck } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { copyText } from '../../components/ui/CopyButton'
import { Dialog } from '../../components/ui/Dialog'
import { Field } from '../../components/ui/Field'
import { errorMessage, get, post, put } from '../../lib/api'
import { cn } from '../../lib/cn'
import { keys, queryClient } from '../../lib/queries'
import { WrongSecretError, createVault, decryptItem, recoverVault, unlockWithPassword } from './crypto'
import { unlockSession } from './session'
import { estimateMasterPassword } from './strength'
import type { VaultItem } from './types'
import { VaultLockArt } from './VaultLockArt'

async function openSession(vaultKey: CryptoKey, userId: string, autoLockMinutes: number) {
  const records = await get<VaultItemRecordDTO[]>('/vault/items')
  const items: VaultItem[] = []
  let failed = 0
  for (const r of records) {
    try {
      items.push(await decryptItem(vaultKey, userId, r.id, r.data))
    } catch {
      failed++
    }
  }
  if (failed) toast.error(`${failed} elemento(s) no se han podido descifrar y se han omitido.`)
  unlockSession(vaultKey, userId, items, autoLockMinutes)
}

function PasswordInput({ label, value, onChange, autoFocus, autoComplete, error, hint }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean; autoComplete: string; error?: string | null; hint?: string }) {
  const [show, setShow] = useState(false)
  return (
    <Field
      label={label}
      type={show ? 'text' : 'password'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoFocus={autoFocus}
      autoComplete={autoComplete}
      error={error}
      hint={hint}
      spellCheck={false}
      trailing={
        <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Ocultar' : 'Mostrar'} className="grid size-8 place-items-center rounded-[8px] text-ink-3 hover:bg-hover hover:text-ink">
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      }
    />
  )
}

function StrengthMeter({ password }: { password: string }) {
  const s = estimateMasterPassword(password)
  return (
    <div>
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className={cn('h-1 flex-1 rounded-full transition-colors', password && s.score > i ? (s.score === 1 ? 'bg-warn' : 'bg-ok') : 'bg-sunken')} />
        ))}
      </div>
      <p className="mt-1.5 text-[12px] text-ink-3" aria-live="polite">
        {s.label && <span className={cn('font-medium', s.score <= 1 ? 'text-warn' : 'text-ok')}>{s.label}. </span>}
        {s.hint}
      </p>
    </div>
  )
}

// ── First-time setup ─────────────────────────────────────────────
export function VaultSetup({ userId, state }: { userId: string; state: VaultStateDTO }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<Awaited<ReturnType<typeof createVault>> | null>(null)
  const [saved, setSaved] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (estimateMasterPassword(password).score === 0) return setError('Usa al menos 12 caracteres.')
    if (password !== confirm) return setError('Las contraseñas no coinciden.')
    setError(null)
    setBusy(true)
    try {
      setCreated(await createVault(password, userId))
    } catch {
      setError('No se ha podido generar la bóveda en este navegador.')
    } finally {
      setBusy(false)
    }
  }

  async function finish() {
    if (!created) return
    setBusy(true)
    try {
      await post('/vault/setup', created.keys)
      await queryClient.invalidateQueries({ queryKey: keys.vault })
      unlockSession(created.vaultKey, userId, [], state.autoLockMinutes)
      toast.success('Bóveda lista. Solo tú puedes abrirla.')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (created) {
    const download = () => {
      const blob = new Blob(
        [`Orqevio — Clave de recuperación de la bóveda\n\n${created.recoveryKey}\n\nGuárdala fuera de Orqevio (por ejemplo, impresa o en otro gestor).\nPermite restablecer la contraseña maestra. Nadie más puede recuperarla por ti.\n`],
        { type: 'text/plain' },
      )
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'orqevio-clave-de-recuperacion.txt'
      a.click()
      URL.revokeObjectURL(url)
    }
    return (
      <GateLayout title="Guarda tu clave de recuperación" subtitle="Es la única forma de recuperar la bóveda si olvidas la contraseña maestra. Se muestra una sola vez.">
        <div className="rounded-[14px] border border-line bg-sunken p-4">
          <p className="text-center font-mono text-[15.5px] leading-relaxed font-medium tracking-[0.06em] break-all text-ink select-all">{created.recoveryKey}</p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button icon={<Copy />} onClick={() => void copyText(created.recoveryKey, { message: 'Clave copiada' })}>
            Copiar
          </Button>
          <Button icon={<Download />} onClick={download}>
            Descargar .txt
          </Button>
        </div>
        <label className="mt-5 flex cursor-pointer items-start gap-3 text-[13px] text-ink-2">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
          La he guardado en un lugar seguro, fuera de Orqevio.
        </label>
        <Button variant="primary" size="lg" className="mt-5 w-full" disabled={!saved} loading={busy} onClick={finish}>
          Abrir mi bóveda
        </Button>
      </GateLayout>
    )
  }

  return (
    <GateLayout title="Configura tu bóveda" subtitle="Elige una contraseña maestra. Se usa en tu navegador para cifrar tus secretos; nunca se envía al servidor.">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <PasswordInput label="Contraseña maestra" value={password} onChange={setPassword} autoFocus autoComplete="new-password" />
        <StrengthMeter password={password} />
        <PasswordInput label="Repite la contraseña maestra" value={confirm} onChange={setConfirm} autoComplete="new-password" error={error} />
        <Button type="submit" variant="primary" size="lg" loading={busy} className="mt-1 w-full">
          {busy ? 'Generando claves…' : 'Crear bóveda'}
        </Button>
      </form>
      <Guarantees />
    </GateLayout>
  )
}

// ── Unlock & recovery ────────────────────────────────────────────
export function VaultUnlock({ userId, state }: { userId: string; state: VaultStateDTO }) {
  const [mode, setMode] = useState<'unlock' | 'recover'>('unlock')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [opening, setOpening] = useState(false)
  const [shake, setShake] = useState(0)

  async function unlock(e: FormEvent) {
    e.preventDefault()
    if (!password) return
    setBusy(true)
    setError(null)
    try {
      const key = await unlockWithPassword(state, password, userId)
      setOpening(true)
      await openSession(key, userId, state.autoLockMinutes)
    } catch (err) {
      setError(err instanceof WrongSecretError ? 'Contraseña maestra incorrecta.' : errorMessage(err))
      setShake((n) => n + 1)
    } finally {
      setBusy(false)
      setPassword('')
    }
  }

  if (mode === 'recover') return <VaultRecover userId={userId} state={state} onBack={() => setMode('unlock')} />

  return (
    <GateLayout title="Bóveda bloqueada" subtitle="Introduce tu contraseña maestra para descifrar tus credenciales en este navegador." art={<VaultLockArt open={opening} busy={busy} />}>
      <form onSubmit={unlock} key={shake} className={cn('flex flex-col gap-4', shake > 0 && 'animate-[shake_0.4s_ease-in-out]')}>
        <PasswordInput label="Contraseña maestra" value={password} onChange={setPassword} autoFocus autoComplete="current-password" error={error} />
        <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
          {busy ? 'Descifrando…' : 'Desbloquear'}
        </Button>
      </form>
      <button type="button" onClick={() => setMode('recover')} className="mt-4 w-full text-center text-[13px] text-ink-3 hover:text-ink">
        ¿Has olvidado la contraseña maestra?
      </button>
      <Guarantees />
      <style>{`@keyframes shake{20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}`}</style>
    </GateLayout>
  )
}

function VaultRecover({ userId, state, onBack }: { userId: string; state: VaultStateDTO; onBack: () => void }) {
  const [recovery, setRecovery] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (estimateMasterPassword(password).score === 0) return setError('La nueva contraseña necesita al menos 12 caracteres.')
    if (password !== confirm) return setError('Las contraseñas no coinciden.')
    setBusy(true)
    setError(null)
    try {
      const { keys: newKeys, vaultKey } = await recoverVault(state, recovery, password, userId)
      await put('/vault/keys', newKeys)
      await queryClient.invalidateQueries({ queryKey: keys.vault })
      await openSession(vaultKey, userId, state.autoLockMinutes)
      toast.success('Contraseña maestra restablecida')
    } catch (err) {
      setError(err instanceof WrongSecretError ? 'La clave de recuperación no es válida.' : errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <GateLayout title="Recuperar la bóveda" subtitle="Usa la clave de recuperación que guardaste al crear la bóveda para elegir una nueva contraseña maestra.">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Clave de recuperación" value={recovery} onChange={(e) => setRecovery(e.target.value)} placeholder="XXXX-XXXX-XXXX-…" autoFocus spellCheck={false} autoComplete="off" className="[&_input]:font-mono [&_input]:uppercase" />
        <PasswordInput label="Nueva contraseña maestra" value={password} onChange={setPassword} autoComplete="new-password" />
        <StrengthMeter password={password} />
        <PasswordInput label="Repite la nueva contraseña" value={confirm} onChange={setConfirm} autoComplete="new-password" error={error} />
        <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
          Restablecer y abrir
        </Button>
      </form>
      <div className="mt-4 flex items-center justify-between text-[13px]">
        <button type="button" onClick={onBack} className="text-ink-3 hover:text-ink">
          ← Volver
        </button>
        <button type="button" onClick={() => setResetOpen(true)} className="text-danger hover:underline">
          No tengo la clave
        </button>
      </div>
      <ResetVaultDialog open={resetOpen} onOpenChange={setResetOpen} />
    </GateLayout>
  )
}

function ResetVaultDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [accessKey, setAccessKey] = useState('')
  const [busy, setBusy] = useState(false)
  async function reset(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await post('/vault/reset', { accessKey })
      await queryClient.invalidateQueries({ queryKey: keys.vault })
      onOpenChange(false)
      toast.success('Bóveda restablecida. Puedes configurarla de nuevo.')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Restablecer la bóveda"
      description="Sin la contraseña maestra ni la clave de recuperación, nadie puede descifrar tus datos, tampoco nosotros. Restablecer borra todos los elementos de forma irreversible."
    >
      <form onSubmit={reset} className="flex flex-col gap-4">
        <Field label="Clave de acceso" type="password" value={accessKey} onChange={(e) => setAccessKey(e.target.value)} autoComplete="current-password" autoFocus spellCheck={false} className="[&_input]:font-mono" hint="Confirma que eres tú con la clave de acceso de esta copia (no con la contraseña maestra)." />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" variant="danger" loading={busy} disabled={!accessKey}>
            Borrar y restablecer
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

function Guarantees() {
  const items = ['Cifrado AES-256-GCM en tu navegador', 'Clave derivada con Argon2id', 'Los agentes y el MCP no tienen acceso']
  return (
    <ul className="mt-8 flex flex-col gap-2 border-t border-line pt-5">
      {items.map((t) => (
        <li key={t} className="flex items-center gap-2.5 text-[12.5px] text-ink-2">
          <Check className="size-3.5 text-ok" />
          {t}
        </li>
      ))}
    </ul>
  )
}

function GateLayout({ title, subtitle, children, art }: { title: string; subtitle: string; children: React.ReactNode; art?: React.ReactNode }) {
  return (
    <div className="grid min-h-full place-items-center px-6 py-12">
      <div className="animate-rise w-full max-w-[400px]">
        <div className="mb-7 flex justify-center">
          {art ?? (
            <div className="grid size-16 place-items-center rounded-[18px] bg-ink text-sheet shadow-md">
              {title.startsWith('Guarda') ? <KeyRound className="size-7" /> : <ShieldCheck className="size-7" />}
            </div>
          )}
        </div>
        <h1 className="text-center font-display text-[28px] leading-tight font-medium tracking-[-0.02em]">{title}</h1>
        <p className="mx-auto mt-2 mb-7 max-w-[360px] text-center text-[13.5px] leading-relaxed text-ink-2">{subtitle}</p>
        {children}
      </div>
    </div>
  )
}
