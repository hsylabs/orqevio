import { PALETTE, type VaultStateDTO } from '@orqevio/shared'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Eye, EyeOff, KeyRound, LockKeyhole, Pencil, Plus, Search, ShieldCheck, Star, StickyNote, Trash, Dices, Ellipsis, Clock, Download, FileUp } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { CopyButton } from '../../components/ui/CopyButton'
import { Dialog } from '../../components/ui/Dialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Field } from '../../components/ui/Field'
import { MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuRoot, MenuSeparator, MenuTrigger } from '../../components/ui/Menu'
import { Popover } from '../../components/ui/Popover'
import { Segmented } from '../../components/ui/Segmented'
import { useConfirm } from '../../components/ui/confirm'
import { del, errorMessage, get, patch, put } from '../../lib/api'
import { cn } from '../../lib/cn'
import { plural, relativeTime } from '../../lib/format'
import { keys, queryClient } from '../../lib/queries'
import { PageHeader } from '../shell/PageHeader'
import { useWorkspace } from '../shell/workspace'
import { WrongSecretError, changeMasterPassword, encryptItem } from './crypto'
import { ExportDialog, ImportDialog } from './TransferDialogs'
import { Generator, PasswordText } from './Generator'
import { getSession, lockVault, setAutoLock, updateSessionItems, useAutoLockRemaining, useVaultSession } from './session'
import { type VaultBlocker, vaultBlockers } from '../../lib/browser'
import { estimateMasterPassword } from './strength'
import { type TotpProblem, groupCode, parseTotp, totp } from './totp'
import { ITEM_LIMITS, type VaultItem, type VaultItemType, emptyItem } from './types'
import { VaultSetup, VaultUnlock } from './VaultGate'

const CLIPBOARD_MS = 30_000

export function VaultPage() {
  const { me } = useWorkspace()
  const state = useQuery({ queryKey: keys.vault, queryFn: ({ signal }) => get<VaultStateDTO>('/vault', signal) })
  const session = useVaultSession()
  const blockers = useMemo(() => vaultBlockers(), [])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader crumbs={[{ label: 'Bóveda' }]} actions={session.key && state.data ? <UnlockedActions state={state.data} /> : undefined} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {blockers.length > 0 ? (
          <VaultUnsupported blockers={blockers} />
        ) : !state.data ? (
          <div className="grid h-full place-items-center">
            <div className="skeleton size-24 rounded-full" />
          </div>
        ) : !state.data.initialized ? (
          <VaultSetup userId={me.user.id} state={state.data} />
        ) : session.key && session.userId === me.user.id ? (
          <Unlocked />
        ) : (
          <VaultUnlock userId={me.user.id} state={state.data} />
        )}
      </div>
    </div>
  )
}

const BLOCKER_TEXT: Record<VaultBlocker, string> = {
  secure_context:
    'Has abierto Orqevio por una conexión sin cifrar (http://). Los navegadores solo permiten el cifrado de la bóveda en conexiones seguras: abre tu copia por https:// (por ejemplo, detrás de Caddy, Nginx o Traefik) o, en el mismo equipo, por http://localhost.',
  webcrypto: 'Este navegador no ofrece WebCrypto, con el que la bóveda cifra tus datos.',
  workers: 'Este navegador no admite Web Workers, que la bóveda usa para derivar tu clave sin bloquear la página.',
  webassembly: 'Este navegador no admite WebAssembly, que la bóveda usa para derivar tu clave con Argon2id.',
}

/** Shown instead of a generic error when the browser cannot run the vault; the rest of the app still works. */
function VaultUnsupported({ blockers }: { blockers: VaultBlocker[] }) {
  const insecure = blockers.includes('secure_context')
  return (
    <div className="mx-auto flex max-w-[520px] flex-col items-center px-6 py-16 text-center">
      <span className="grid size-12 place-items-center rounded-[14px] bg-sunken text-ink-2">
        <LockKeyhole className="size-6" />
      </span>
      <h1 className="mt-5 font-display text-[24px] font-medium">{insecure ? 'La bóveda necesita una conexión segura' : 'La bóveda no funciona en este navegador'}</h1>
      <ul className="mt-4 flex flex-col gap-2 text-[14px] leading-relaxed text-ink-2">
        {blockers.map((b) => (
          <li key={b}>{BLOCKER_TEXT[b]}</li>
        ))}
      </ul>
      {!insecure && <p className="mt-4 text-[13px] text-ink-3">Usa una versión actual de Chrome, Edge, Firefox o Safari.</p>}
      <p className="mt-4 text-[13px] text-ink-3">Tus tareas y documentos siguen funcionando con normalidad.</p>
    </div>
  )
}

function AutoLockRing() {
  const remaining = useAutoLockRemaining()
  const total = getSession().autoLockMinutes * 60
  const pct = total ? remaining / total : 0
  const r = 8
  const c = 2 * Math.PI * r
  const mm = Math.floor(remaining / 60)
  const ss = String(remaining % 60).padStart(2, '0')
  return (
    <span className="mr-1 inline-flex items-center gap-1.5 text-[12px] text-ink-3 tabular max-sm:hidden" title="Bloqueo automático por inactividad">
      <svg width="20" height="20" viewBox="0 0 20 20" className="-rotate-90" aria-hidden="true">
        <circle cx="10" cy="10" r={r} fill="none" stroke="var(--line-strong)" strokeWidth="2" />
        <circle cx="10" cy="10" r={r} fill="none" stroke={pct < 0.15 ? 'var(--warn)' : 'var(--ok)'} strokeWidth="2" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - pct * c} style={{ transition: 'stroke-dashoffset 1s linear' }} />
      </svg>
      <span className="font-mono">
        {mm}:{ss}
      </span>
    </span>
  )
}

function UnlockedActions({ state }: { state: VaultStateDTO }) {
  const session = useVaultSession()
  const [changeOpen, setChangeOpen] = useState(false)
  const [generatorOpen, setGeneratorOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  async function changeAutoLock(value: string) {
    const minutes = Number(value)
    setAutoLock(minutes)
    try {
      await patch('/vault/settings', { autoLockMinutes: minutes })
      await queryClient.invalidateQueries({ queryKey: keys.vault })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <>
      <AutoLockRing />
      <Button variant="ghost" size="sm" icon={<Dices />} onClick={() => setGeneratorOpen(true)}>
        <span className="max-sm:hidden">Generador</span>
      </Button>
      <MenuRoot>
        <MenuTrigger asChild>
          <Button variant="ghost" size="sm" iconOnly icon={<Ellipsis />} aria-label="Opciones de la bóveda" />
        </MenuTrigger>
        <MenuContent>
          <MenuItem icon={<KeyRound />} onSelect={() => setChangeOpen(true)}>
            Cambiar contraseña maestra
          </MenuItem>
          <MenuItem icon={<FileUp />} onSelect={() => setImportOpen(true)}>
            Importar…
          </MenuItem>
          <MenuItem icon={<Download />} onSelect={() => setExportOpen(true)}>
            Exportar…
          </MenuItem>
          <MenuSeparator />
          <MenuLabel>Bloqueo automático</MenuLabel>
          <MenuRadioGroup value={String(session.autoLockMinutes)} onValueChange={changeAutoLock}>
            {[1, 5, 15, 30, 60].map((m) => (
              <MenuRadioItem key={m} value={String(m)} icon={<Clock />}>
                {m === 60 ? '1 hora' : `${m} min`} de inactividad
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuContent>
      </MenuRoot>
      <Button variant="primary" size="sm" icon={<LockKeyhole />} onClick={lockVault}>
        Bloquear
      </Button>
      <ChangeMasterDialog open={changeOpen} onOpenChange={setChangeOpen} state={state} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} state={state} />
      <Dialog open={generatorOpen} onOpenChange={setGeneratorOpen} title="Generador de contraseñas" description="Aleatoriedad criptográfica del navegador, sin sesgo.">
        <Generator />
      </Dialog>
    </>
  )
}

function monogramColor(title: string) {
  let h = 0
  for (const ch of title) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % (PALETTE.length - 1)]
}

function host(url: string) {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function Unlocked() {
  const session = useVaultSession()
  const confirm = useConfirm()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | VaultItemType | 'favorite'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(session.items[0]?.id ?? null)
  const [draft, setDraft] = useState<VaultItem | null>(null)

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...session.items]
      .filter((i) => (filter === 'all' ? true : filter === 'favorite' ? i.favorite : i.type === filter))
      .filter((i) => !q || `${i.title} ${i.username} ${i.url}`.toLowerCase().includes(q))
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.title.localeCompare(b.title, 'es'))
  }, [session.items, query, filter])

  const selected = session.items.find((i) => i.id === selectedId) ?? null

  async function save(item: VaultItem) {
    const s = getSession()
    if (!s.key || !s.userId) return false
    const next = { ...item, title: item.title.trim() || (item.type === 'login' ? host(item.url) || 'Sin título' : 'Nota sin título'), updatedAt: new Date().toISOString() }
    try {
      const data = await encryptItem(s.key, s.userId, next)
      await put(`/vault/items/${next.id}`, { data })
      updateSessionItems(s.key, (items) => (items.some((i) => i.id === next.id) ? items.map((i) => (i.id === next.id ? next : i)) : [...items, next]))
      setSelectedId(next.id)
      return true
    } catch (error) {
      toast.error(errorMessage(error))
      return false
    }
  }

  async function remove(item: VaultItem) {
    if (!(await confirm({ title: `¿Eliminar «${item.title}»?`, description: 'Se borrará de forma definitiva de tu bóveda.', confirmLabel: 'Eliminar', danger: true }))) return
    const { key } = getSession()
    if (!key) return
    try {
      await del(`/vault/items/${item.id}`)
      updateSessionItems(key, (items) => items.filter((i) => i.id !== item.id))
      setSelectedId(null)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const startNew = (type: VaultItemType) => {
    setDraft(emptyItem(type))
    setSelectedId(null)
  }

  return (
    <div className="grid h-full min-h-0 md:grid-cols-[minmax(280px,340px)_1fr]">
      <aside className={cn('flex min-h-0 flex-col border-line md:border-r', (draft || selected) && 'max-md:hidden')}>
        <div className="flex flex-col gap-2.5 border-b border-line p-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-4" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar en la bóveda" aria-label="Buscar en la bóveda" className="field h-8.5 pl-8" />
            </div>
            <MenuRoot>
              <MenuTrigger asChild>
                <Button variant="primary" size="sm" icon={<Plus />} className="h-8.5">
                  Nuevo
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem icon={<KeyRound />} onSelect={() => startNew('login')}>
                  Credencial
                </MenuItem>
                <MenuItem icon={<StickyNote />} onSelect={() => startNew('note')}>
                  Nota segura
                </MenuItem>
              </MenuContent>
            </MenuRoot>
          </div>
          <Segmented
            size="sm"
            label="Filtrar"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'Todo' },
              { value: 'login', label: 'Credenciales' },
              { value: 'note', label: 'Notas' },
              { value: 'favorite', label: '★' },
            ]}
          />
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-1.5" aria-label="Elementos de la bóveda">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => {
                  setDraft(null)
                  setSelectedId(item.id)
                }}
                aria-current={item.id === selectedId && !draft}
                className={cn('flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left transition-colors', item.id === selectedId && !draft ? 'bg-surface shadow-sm' : 'hover:bg-hover')}
              >
                <Monogram item={item} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium">{item.title}</span>
                  <span className="block truncate text-[12px] text-ink-3">{item.type === 'login' ? item.username || host(item.url) || 'Credencial' : 'Nota segura'}</span>
                </span>
                {item.favorite && <Star className="size-3.5 fill-[var(--warn)] text-warn" />}
              </button>
            </li>
          ))}
          {items.length === 0 && (
            <li className="px-4 py-10 text-center text-[13px] text-ink-3">{session.items.length ? 'Sin coincidencias.' : 'Tu bóveda está vacía.'}</li>
          )}
        </ul>
        <p className="flex items-center gap-1.5 border-t border-line px-4 py-2.5 text-[11.5px] text-ink-3">
          <ShieldCheck className="size-3.5 text-ok" />
          {plural(session.items.length, 'elemento', 'elementos')} · descifrados solo en este navegador
        </p>
      </aside>

      <section className={cn('min-h-0 overflow-y-auto', !draft && !selected && 'max-md:hidden')}>
        {draft ? (
          <ItemEditor
            key={draft.id}
            initial={draft}
            onCancel={() => setDraft(null)}
            onSave={async (item) => {
              if (await save(item)) setDraft(null)
            }}
          />
        ) : selected ? (
          <ItemDetail
            key={selected.id}
            item={selected}
            onBack={() => setSelectedId(null)}
            onEdit={() => setDraft(selected)}
            onDelete={() => void remove(selected)}
            onToggleFavorite={() => void save({ ...selected, favorite: !selected.favorite })}
          />
        ) : (
          <EmptyState icon={<KeyRound />} title={session.items.length ? 'Selecciona un elemento' : 'Guarda tu primera credencial'} action={<Button variant="primary" icon={<Plus />} onClick={() => startNew('login')}>Nueva credencial</Button>}>
            Todo se cifra en tu navegador antes de salir hacia el servidor. Ni el servidor ni tus agentes pueden leerlo.
          </EmptyState>
        )}
      </section>
    </div>
  )
}

function Monogram({ item, size = 34 }: { item: VaultItem; size?: number }) {
  return (
    <span className={cn('glyph rounded-[9px]', `c-${item.type === 'note' ? 'slate' : monogramColor(item.title)}`)} style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {item.type === 'note' ? <StickyNote style={{ width: size * 0.45, height: size * 0.45 }} /> : (item.title[0] ?? '·').toUpperCase()}
    </span>
  )
}

function DetailField({ label, children, actions }: { label: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="group flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] font-medium text-ink-3">{label}</p>
        <div className="mt-0.5 text-[14px] [overflow-wrap:anywhere]">{children}</div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
    </div>
  )
}

function ItemDetail({ item, onEdit, onDelete, onToggleFavorite, onBack }: { item: VaultItem; onEdit: () => void; onDelete: () => void; onToggleFavorite: () => void; onBack: () => void }) {
  const [reveal, setReveal] = useState(false)
  useEffect(() => {
    if (!reveal) return
    const t = setTimeout(() => setReveal(false), 20_000)
    return () => clearTimeout(t)
  }, [reveal])
  const safeUrl = item.url ? (/^https?:\/\//i.test(item.url) ? item.url : `https://${item.url}`) : ''

  return (
    <div className="animate-rise mx-auto w-full max-w-[620px] px-6 py-8 sm:px-10">
      <button type="button" onClick={onBack} className="mb-4 text-[13px] text-ink-3 hover:text-ink md:hidden">
        ← Volver
      </button>
      <div className="flex items-start gap-4">
        <Monogram item={item} size={52} />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[26px] leading-tight font-medium tracking-[-0.02em] [overflow-wrap:anywhere]">{item.title}</h1>
          <p className="mt-1 text-[12.5px] text-ink-3">
            {item.type === 'login' ? 'Credencial' : 'Nota segura'} · actualizada {relativeTime(item.updatedAt)}
          </p>
        </div>
        <div className="flex gap-0.5">
          <Button variant="ghost" size="sm" iconOnly aria-label={item.favorite ? 'Quitar de favoritos' : 'Marcar como favorito'} icon={<Star className={item.favorite ? 'fill-[var(--warn)] text-warn' : undefined} />} onClick={onToggleFavorite} />
          <Button variant="ghost" size="sm" iconOnly aria-label="Editar" icon={<Pencil />} onClick={onEdit} />
          <Button variant="ghost" size="sm" iconOnly aria-label="Eliminar" icon={<Trash />} onClick={onDelete} className="hover:text-danger" />
        </div>
      </div>

      <div className="mt-7 overflow-hidden rounded-[14px] border border-line bg-surface shadow-sm">
        {item.type === 'login' && (
          <>
            <DetailField label="Usuario" actions={item.username ? <CopyButton value={item.username} label="Copiar usuario" message="Usuario copiado" /> : null}>
              {item.username || <span className="text-ink-4">—</span>}
            </DetailField>
            <DetailField
              label="Contraseña"
              actions={
                item.password ? (
                  <>
                    <button type="button" onClick={() => setReveal((r) => !r)} aria-label={reveal ? 'Ocultar contraseña' : 'Mostrar contraseña'} className="grid size-7 place-items-center rounded-[8px] text-ink-3 hover:bg-hover hover:text-ink">
                      {reveal ? <EyeOff className="size-[15px]" /> : <Eye className="size-[15px]" />}
                    </button>
                    <CopyButton value={item.password} label="Copiar contraseña" clearAfterMs={CLIPBOARD_MS} message="Contraseña copiada · se borrará del portapapeles en 30 s" />
                  </>
                ) : null
              }
            >
              {item.password ? reveal ? <PasswordText value={item.password} className="text-[14.5px]" /> : <span className="font-mono tracking-[0.2em] text-ink-2">••••••••••••</span> : <span className="text-ink-4">—</span>}
            </DetailField>
            {item.totp && <TotpField value={item.totp} />}
            <DetailField
              label="Sitio web"
              actions={
                safeUrl ? (
                  <>
                    <a href={safeUrl} target="_blank" rel="noopener noreferrer" aria-label="Abrir sitio" className="grid size-7 place-items-center rounded-[8px] text-ink-3 hover:bg-hover hover:text-ink">
                      <ExternalLink className="size-[15px]" />
                    </a>
                    <CopyButton value={item.url} label="Copiar dirección" message="Dirección copiada" />
                  </>
                ) : null
              }
            >
              {item.url ? host(item.url) : <span className="text-ink-4">—</span>}
            </DetailField>
          </>
        )}
        <DetailField label={item.type === 'note' ? 'Contenido' : 'Notas'} actions={item.notes ? <CopyButton value={item.notes} label="Copiar notas" clearAfterMs={CLIPBOARD_MS} message="Copiado" /> : null}>
          {item.notes ? <p className="whitespace-pre-wrap">{item.notes}</p> : <span className="text-ink-4">—</span>}
        </DetailField>
      </div>
      <p className="mt-4 flex items-center gap-1.5 text-[12px] text-ink-3">
        <ShieldCheck className="size-3.5 text-ok" /> Al copiar, el portapapeles se vacía automáticamente a los 30 segundos.
      </p>
    </div>
  )
}

const TOTP_PROBLEMS: Record<TotpProblem, string> = {
  empty: 'Escribe la clave secreta o el enlace otpauth://.',
  not_totp: 'Solo se admiten códigos que cambian con el tiempo (TOTP).',
  bad_secret: 'La clave secreta solo puede tener letras de la A a la Z y números del 2 al 7.',
  too_short: 'La clave secreta es demasiado corta.',
  bad_parameters: 'El enlace otpauth:// tiene parámetros que no son válidos.',
}

/** The current code, refreshed every second; computed here, never on the server. */
function TotpField({ value }: { value: string }) {
  const config = useMemo(() => parseTotp(value), [value])
  const [now, setNow] = useState(() => Date.now())
  const [current, setCurrent] = useState<{ code: string; remaining: number } | null>(null)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (typeof config === 'string') return
    let alive = true
    void totp(config, now).then((next) => alive && setCurrent(next))
    return () => {
      alive = false
    }
  }, [config, now])
  if (typeof config === 'string') {
    return (
      <DetailField label="Código de verificación">
        <span className="text-danger">{TOTP_PROBLEMS[config]}</span>
      </DetailField>
    )
  }
  return (
    <DetailField
      label="Código de verificación"
      actions={current ? <CopyButton value={current.code} label="Copiar código" clearAfterMs={CLIPBOARD_MS} message="Código copiado · se borrará del portapapeles en 30 s" /> : null}
    >
      {current ? (
        <span className="flex items-center gap-3">
          <span aria-label="Código de verificación actual" className="font-mono text-[18px] tracking-[0.12em] text-ink">
            {groupCode(current.code)}
          </span>
          <span className={cn('text-[12px] tabular-nums', current.remaining <= 5 ? 'text-warn' : 'text-ink-3')} aria-label={`Cambia en ${current.remaining} segundos`}>
            {current.remaining} s
          </span>
        </span>
      ) : (
        <span className="text-ink-4">…</span>
      )}
    </DetailField>
  )
}

function ItemEditor({ initial, onSave, onCancel }: { initial: VaultItem; onSave: (item: VaultItem) => Promise<void>; onCancel: () => void }) {
  const [item, setItem] = useState(initial)
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [genOpen, setGenOpen] = useState(false)
  const [totpError, setTotpError] = useState<string | null>(null)
  const set = <K extends keyof VaultItem>(key: K, value: VaultItem[K]) => setItem((i) => ({ ...i, [key]: value }))

  function changeTotp(value: string) {
    setTotpError(null)
    const parsed = parseTotp(value)
    setItem((i) => {
      const next = { ...i, totp: value }
      // An otpauth:// link names the service and the account: fill them in when empty.
      if (typeof parsed !== 'string') {
        if (!i.title.trim() && parsed.issuer) next.title = parsed.issuer
        if (!i.username.trim() && parsed.account) next.username = parsed.account
      }
      return next
    })
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = item.type === 'login' && item.totp.trim() ? parseTotp(item.totp) : null
    if (typeof problem === 'string') {
      setTotpError(TOTP_PROBLEMS[problem])
      return
    }
    setBusy(true)
    await onSave(item)
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="animate-rise mx-auto flex w-full max-w-[620px] flex-col gap-4 px-6 py-8 sm:px-10">
      <h1 className="font-display text-[24px] font-medium">{initial.title ? 'Editar' : item.type === 'login' ? 'Nueva credencial' : 'Nueva nota segura'}</h1>
      <Field label="Nombre" value={item.title} onChange={(e) => set('title', e.target.value)} placeholder={item.type === 'login' ? 'p. ej. Banco, GitHub, Wi-Fi oficina' : 'p. ej. Códigos de respaldo'} autoFocus maxLength={ITEM_LIMITS.title} />
      {item.type === 'login' && (
        <>
          <Field label="Usuario o correo" value={item.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" spellCheck={false} maxLength={ITEM_LIMITS.username} />
          <Field
            label="Contraseña"
            type={show ? 'text' : 'password'}
            value={item.password}
            onChange={(e) => set('password', e.target.value)}
            autoComplete="new-password"
            spellCheck={false}
            className="[&_input]:pr-[72px] [&_input]:font-mono"
            maxLength={ITEM_LIMITS.password}
            trailing={
              <span className="flex items-center gap-0.5 pr-0.5">
                <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Ocultar' : 'Mostrar'} className="grid size-8 place-items-center rounded-[8px] text-ink-3 hover:bg-hover hover:text-ink">
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
                <Popover
                  open={genOpen}
                  onOpenChange={setGenOpen}
                  align="end"
                  className="w-[340px] p-4"
                  trigger={
                    <button type="button" aria-label="Generar contraseña" title="Generar contraseña" className="grid size-8 place-items-center rounded-[8px] text-ink-3 hover:bg-hover hover:text-ink">
                      <Dices className="size-4" />
                    </button>
                  }
                >
                  <Generator
                    onUse={(pwd) => {
                      set('password', pwd)
                      setShow(true)
                      setGenOpen(false)
                    }}
                  />
                </Popover>
              </span>
            }
          />
          <Field label="Sitio web" value={item.url} onChange={(e) => set('url', e.target.value)} placeholder="ejemplo.com" inputMode="url" autoComplete="off" spellCheck={false} maxLength={ITEM_LIMITS.url} />
          <Field
            label="Verificación en dos pasos (TOTP)"
            value={item.totp}
            onChange={(e) => changeTotp(e.target.value)}
            placeholder="Clave secreta o enlace otpauth://"
            hint="La clave que te muestra el servicio al activar la verificación en dos pasos, junto al código QR."
            error={totpError}
            autoComplete="off"
            spellCheck={false}
            className="[&_input]:font-mono"
            maxLength={ITEM_LIMITS.totp}
          />
        </>
      )}
      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium text-ink-2">{item.type === 'note' ? 'Contenido' : 'Notas'}</span>
        <textarea value={item.notes} onChange={(e) => set('notes', e.target.value)} rows={item.type === 'note' ? 10 : 4} maxLength={ITEM_LIMITS.notes} className="field h-auto resize-y py-2 leading-relaxed" />
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" loading={busy} icon={<ShieldCheck />}>
          Cifrar y guardar
        </Button>
      </div>
    </form>
  )
}

function ChangeMasterDialog({ open, onOpenChange, state }: { open: boolean; onOpenChange: (o: boolean) => void; state: VaultStateDTO }) {
  const { me } = useWorkspace()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (estimateMasterPassword(next).score === 0) return setError('La nueva contraseña necesita al menos 12 caracteres.')
    if (next !== confirm) return setError('Las contraseñas no coinciden.')
    setBusy(true)
    setError(null)
    try {
      const fresh = await get<VaultStateDTO>('/vault')
      const newKeys = await changeMasterPassword(fresh, current, next, me.user.id)
      await put('/vault/keys', newKeys)
      await queryClient.invalidateQueries({ queryKey: keys.vault })
      onOpenChange(false)
      setCurrent('')
      setNext('')
      setConfirm('')
      toast.success('Contraseña maestra actualizada')
    } catch (err) {
      setError(err instanceof WrongSecretError ? 'La contraseña maestra actual no es correcta.' : errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Cambiar contraseña maestra" description="Tus elementos no se vuelven a cifrar: solo se protege la clave de la bóveda con la nueva contraseña. Tu clave de recuperación sigue siendo válida.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Contraseña maestra actual" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" autoFocus />
        <Field label="Nueva contraseña maestra" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" hint={estimateMasterPassword(next).hint} />
        <Field label="Repite la nueva contraseña" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" error={error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!current || !next}>
            Cambiar
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
