import type { VaultItemRecordDTO, VaultStateDTO } from '@orqevio/shared'
import { t as translate } from 'i18next'
import { Check, Copy, Download, Eye, EyeOff, KeyRound, ShieldCheck } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  if (failed) toast.error(translate('vault:gate.decryptFailed', { count: failed }))
  unlockSession(vaultKey, userId, items, autoLockMinutes)
}

function PasswordInput({ label, value, onChange, autoFocus, autoComplete, error, hint }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean; autoComplete: string; error?: string | null; hint?: string }) {
  const { t } = useTranslation('vault')
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
        <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? t('reveal.hide') : t('reveal.show')} className="grid size-8 place-items-center rounded-[8px] text-ink-3 hover:bg-hover hover:text-ink">
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
  const { t } = useTranslation(['vault', 'common'])
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<Awaited<ReturnType<typeof createVault>> | null>(null)
  const [saved, setSaved] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (estimateMasterPassword(password).score === 0) return setError(t('gate.setup.tooShort'))
    if (password !== confirm) return setError(t('master.mismatch'))
    setError(null)
    setBusy(true)
    try {
      setCreated(await createVault(password, userId))
    } catch {
      setError(t('gate.setup.failed'))
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
      toast.success(t('gate.setup.ready'))
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (created) {
    const download = () => {
      const blob = new Blob([t('gate.recoveryKey.fileText', { recoveryKey: created.recoveryKey })], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = t('gate.recoveryKey.fileName')
      a.click()
      URL.revokeObjectURL(url)
    }
    return (
      <GateLayout title={t('gate.recoveryKey.title')} subtitle={t('gate.recoveryKey.subtitle')} icon={<KeyRound className="size-7" />}>
        <div className="rounded-[14px] border border-line bg-sunken p-4">
          <p className="text-center font-mono text-[15.5px] leading-relaxed font-medium tracking-[0.06em] break-all text-ink select-all">{created.recoveryKey}</p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button icon={<Copy />} onClick={() => void copyText(created.recoveryKey, { message: t('gate.recoveryKey.copied') })}>
            {t('common:actions.copy')}
          </Button>
          <Button icon={<Download />} onClick={download}>
            {t('gate.recoveryKey.download')}
          </Button>
        </div>
        <label className="mt-5 flex cursor-pointer items-start gap-3 text-[13px] text-ink-2">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
          {t('gate.recoveryKey.saved')}
        </label>
        <Button variant="primary" size="lg" className="mt-5 w-full" disabled={!saved} loading={busy} onClick={finish}>
          {t('gate.recoveryKey.open')}
        </Button>
      </GateLayout>
    )
  }

  return (
    <GateLayout title={t('gate.setup.title')} subtitle={t('gate.setup.subtitle')}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <PasswordInput label={t('master.label')} value={password} onChange={setPassword} autoFocus autoComplete="new-password" />
        <StrengthMeter password={password} />
        <PasswordInput label={t('gate.setup.repeat')} value={confirm} onChange={setConfirm} autoComplete="new-password" error={error} />
        <Button type="submit" variant="primary" size="lg" loading={busy} className="mt-1 w-full">
          {busy ? t('gate.setup.busy') : t('gate.setup.submit')}
        </Button>
      </form>
      <Guarantees />
    </GateLayout>
  )
}

// ── Unlock & recovery ────────────────────────────────────────────
export function VaultUnlock({ userId, state }: { userId: string; state: VaultStateDTO }) {
  const { t } = useTranslation('vault')
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
      setError(err instanceof WrongSecretError ? t('master.wrong') : errorMessage(err))
      setShake((n) => n + 1)
    } finally {
      setBusy(false)
      setPassword('')
    }
  }

  if (mode === 'recover') return <VaultRecover userId={userId} state={state} onBack={() => setMode('unlock')} />

  return (
    <GateLayout title={t('gate.unlock.title')} subtitle={t('gate.unlock.subtitle')} art={<VaultLockArt open={opening} busy={busy} />}>
      <form onSubmit={unlock} key={shake} className={cn('flex flex-col gap-4', shake > 0 && 'animate-[shake_0.4s_ease-in-out]')}>
        <PasswordInput label={t('master.label')} value={password} onChange={setPassword} autoFocus autoComplete="current-password" error={error} />
        <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
          {busy ? t('gate.unlock.busy') : t('gate.unlock.submit')}
        </Button>
      </form>
      <button type="button" onClick={() => setMode('recover')} className="mt-4 w-full text-center text-[13px] text-ink-3 hover:text-ink">
        {t('gate.unlock.forgot')}
      </button>
      <Guarantees />
      <style>{`@keyframes shake{20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}`}</style>
    </GateLayout>
  )
}

function VaultRecover({ userId, state, onBack }: { userId: string; state: VaultStateDTO; onBack: () => void }) {
  const { t } = useTranslation('vault')
  const [recovery, setRecovery] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (estimateMasterPassword(password).score === 0) return setError(t('master.newTooShort'))
    if (password !== confirm) return setError(t('master.mismatch'))
    setBusy(true)
    setError(null)
    try {
      const { keys: newKeys, vaultKey } = await recoverVault(state, recovery, password, userId)
      await put('/vault/keys', newKeys)
      await queryClient.invalidateQueries({ queryKey: keys.vault })
      await openSession(vaultKey, userId, state.autoLockMinutes)
      toast.success(t('gate.recover.done'))
    } catch (err) {
      setError(err instanceof WrongSecretError ? t('gate.recover.invalidKey') : errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <GateLayout title={t('gate.recover.title')} subtitle={t('gate.recover.subtitle')}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label={t('gate.recover.recoveryKey')} value={recovery} onChange={(e) => setRecovery(e.target.value)} placeholder={t('gate.recover.recoveryKeyPlaceholder')} autoFocus spellCheck={false} autoComplete="off" className="[&_input]:font-mono [&_input]:uppercase" />
        <PasswordInput label={t('master.new')} value={password} onChange={setPassword} autoComplete="new-password" />
        <StrengthMeter password={password} />
        <PasswordInput label={t('master.repeatNew')} value={confirm} onChange={setConfirm} autoComplete="new-password" error={error} />
        <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
          {t('gate.recover.submit')}
        </Button>
      </form>
      <div className="mt-4 flex items-center justify-between text-[13px]">
        <button type="button" onClick={onBack} className="text-ink-3 hover:text-ink">
          {t('back')}
        </button>
        <button type="button" onClick={() => setResetOpen(true)} className="text-danger hover:underline">
          {t('gate.recover.noKey')}
        </button>
      </div>
      <ResetVaultDialog open={resetOpen} onOpenChange={setResetOpen} />
    </GateLayout>
  )
}

function ResetVaultDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation(['vault', 'common'])
  const [accessKey, setAccessKey] = useState('')
  const [busy, setBusy] = useState(false)
  async function reset(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await post('/vault/reset', { accessKey })
      await queryClient.invalidateQueries({ queryKey: keys.vault })
      onOpenChange(false)
      toast.success(t('gate.reset.done'))
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
      title={t('gate.reset.title')}
      description={t('gate.reset.description')}
    >
      <form onSubmit={reset} className="flex flex-col gap-4">
        <Field label={t('gate.reset.accessKey')} type="password" value={accessKey} onChange={(e) => setAccessKey(e.target.value)} autoComplete="current-password" autoFocus spellCheck={false} className="[&_input]:font-mono" hint={t('gate.reset.accessKeyHint')} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" variant="danger" loading={busy} disabled={!accessKey}>
            {t('gate.reset.submit')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

function Guarantees() {
  const { t } = useTranslation('vault')
  return (
    <ul className="mt-8 flex flex-col gap-2 border-t border-line pt-5">
      {(['encryption', 'kdf', 'agents'] as const).map((guarantee) => (
        <li key={guarantee} className="flex items-center gap-2.5 text-[12.5px] text-ink-2">
          <Check className="size-3.5 text-ok" />
          {t(`gate.guarantees.${guarantee}`)}
        </li>
      ))}
    </ul>
  )
}

function GateLayout({ title, subtitle, children, art, icon = <ShieldCheck className="size-7" /> }: { title: string; subtitle: string; children: ReactNode; art?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="grid min-h-full place-items-center px-6 py-12">
      <div className="animate-rise w-full max-w-[400px]">
        <div className="mb-7 flex justify-center">
          {art ?? (
            <div className="grid size-16 place-items-center rounded-[18px] bg-ink text-sheet shadow-md">
              {icon}
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
