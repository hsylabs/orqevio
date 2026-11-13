import { PALETTE, type VaultStateDTO } from '@orqevio/shared'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Eye, EyeOff, KeyRound, LockKeyhole, Pencil, Plus, Search, ShieldCheck, Star, StickyNote, Trash, Dices, Ellipsis, Clock, Download, FileUp } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { relativeTime } from '../../lib/format'
import { keys, queryClient } from '../../lib/queries'
import { PageHeader } from '../shell/PageHeader'
import { useWorkspace } from '../shell/workspace'
import { WrongSecretError, changeMasterPassword, encryptItem } from './crypto'
import { ExportDialog, ImportDialog } from './TransferDialogs'
import { Generator, PasswordText } from './Generator'
import { getSession, lockVault, setAutoLock, updateSessionItems, useAutoLockRemaining, useVaultSession } from './session'
import { type VaultBlocker, vaultBlockers } from '../../lib/browser'
import { estimateMasterPassword } from './strength'
import { groupCode, parseTotp, totp } from './totp'
import { ITEM_LIMITS, type VaultItem, type VaultItemType, emptyItem } from './types'
import { VaultSetup, VaultUnlock } from './VaultGate'

const CLIPBOARD_MS = 30_000

export function VaultPage() {
  const { t } = useTranslation('vault')
  const { me } = useWorkspace()
  const state = useQuery({ queryKey: keys.vault, queryFn: ({ signal }) => get<VaultStateDTO>('/vault', signal) })
  const session = useVaultSession()
  const blockers = useMemo(() => vaultBlockers(), [])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader crumbs={[{ label: t('title') }]} actions={session.key && state.data ? <UnlockedActions state={state.data} /> : undefined} />
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

/** Shown instead of a generic error when the browser cannot run the vault; the rest of the app still works. */
function VaultUnsupported({ blockers }: { blockers: VaultBlocker[] }) {
  const { t } = useTranslation('vault')
  const insecure = blockers.includes('secure_context')
  return (
    <div className="mx-auto flex max-w-[520px] flex-col items-center px-6 py-16 text-center">
      <span className="grid size-12 place-items-center rounded-[14px] bg-sunken text-ink-2">
        <LockKeyhole className="size-6" />
      </span>
      <h1 className="mt-5 font-display text-[24px] font-medium">{insecure ? t('unsupported.insecureTitle') : t('unsupported.browserTitle')}</h1>
      <ul className="mt-4 flex flex-col gap-2 text-[14px] leading-relaxed text-ink-2">
        {blockers.map((b) => (
          <li key={b}>{t(`unsupported.blockers.${b}`)}</li>
        ))}
      </ul>
      {!insecure && <p className="mt-4 text-[13px] text-ink-3">{t('unsupported.updateBrowser')}</p>}
      <p className="mt-4 text-[13px] text-ink-3">{t('unsupported.restWorks')}</p>
    </div>
  )
}

function AutoLockRing() {
  const { t } = useTranslation('vault')
  const remaining = useAutoLockRemaining()
  const total = getSession().autoLockMinutes * 60
  const pct = total ? remaining / total : 0
  const r = 8
  const c = 2 * Math.PI * r
  const mm = Math.floor(remaining / 60)
  const ss = String(remaining % 60).padStart(2, '0')
  return (
    <span className="mr-1 inline-flex items-center gap-1.5 text-[12px] text-ink-3 tabular max-sm:hidden" title={t('toolbar.autoLockTimer')}>
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
  const { t } = useTranslation('vault')
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
        <span className="max-sm:hidden">{t('toolbar.generator')}</span>
      </Button>
      <MenuRoot>
        <MenuTrigger asChild>
          <Button variant="ghost" size="sm" iconOnly icon={<Ellipsis />} aria-label={t('toolbar.options')} />
        </MenuTrigger>
        <MenuContent>
          <MenuItem icon={<KeyRound />} onSelect={() => setChangeOpen(true)}>
            {t('toolbar.changeMaster')}
          </MenuItem>
          <MenuItem icon={<FileUp />} onSelect={() => setImportOpen(true)}>
            {t('toolbar.import')}
          </MenuItem>
          <MenuItem icon={<Download />} onSelect={() => setExportOpen(true)}>
            {t('toolbar.export')}
          </MenuItem>
          <MenuSeparator />
          <MenuLabel>{t('toolbar.autoLock')}</MenuLabel>
          <MenuRadioGroup value={String(session.autoLockMinutes)} onValueChange={changeAutoLock}>
            {[1, 5, 15, 30, 60].map((m) => (
              <MenuRadioItem key={m} value={String(m)} icon={<Clock />}>
                {m % 60 === 0 ? t('toolbar.autoLockHours', { count: m / 60 }) : t('toolbar.autoLockMinutes', { count: m })}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuContent>
      </MenuRoot>
      <Button variant="primary" size="sm" icon={<LockKeyhole />} onClick={lockVault}>
        {t('toolbar.lock')}
      </Button>
      <ChangeMasterDialog open={changeOpen} onOpenChange={setChangeOpen} state={state} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} state={state} />
      <Dialog open={generatorOpen} onOpenChange={setGeneratorOpen} title={t('toolbar.generatorTitle')} description={t('toolbar.generatorDescription')}>
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
  const { t, i18n } = useTranslation('vault')
  const language = i18n.resolvedLanguage
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
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.title.localeCompare(b.title, language))
  }, [session.items, query, filter, language])

  const selected = session.items.find((i) => i.id === selectedId) ?? null

  async function save(item: VaultItem) {
    const s = getSession()
    if (!s.key || !s.userId) return false
    const next = { ...item, title: item.title.trim() || (item.type === 'login' ? host(item.url) || t('untitled.login') : t('untitled.note')), updatedAt: new Date().toISOString() }
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
    if (!(await confirm({ title: t('delete.title', { title: item.title }), description: t('delete.description'), confirmLabel: t('delete.confirm'), danger: true }))) return
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
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('list.search')} aria-label={t('list.search')} className="field h-8.5 pl-8" />
            </div>
            <MenuRoot>
              <MenuTrigger asChild>
                <Button variant="primary" size="sm" icon={<Plus />} className="h-8.5">
                  {t('list.new')}
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem icon={<KeyRound />} onSelect={() => startNew('login')}>
                  {t('types.login')}
                </MenuItem>
                <MenuItem icon={<StickyNote />} onSelect={() => startNew('note')}>
                  {t('types.note')}
                </MenuItem>
              </MenuContent>
            </MenuRoot>
          </div>
          <Segmented
            size="sm"
            label={t('list.filter')}
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: t('list.filters.all') },
              { value: 'login', label: t('list.filters.logins') },
              { value: 'note', label: t('list.filters.notes') },
              { value: 'favorite', label: '★' },
            ]}
          />
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-1.5" aria-label={t('list.label')}>
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
                  <span className="block truncate text-[12px] text-ink-3">{item.type === 'login' ? item.username || host(item.url) || t('types.login') : t('types.note')}</span>
                </span>
                {item.favorite && <Star className="size-3.5 fill-[var(--warn)] text-warn" />}
              </button>
            </li>
          ))}
          {items.length === 0 && (
            <li className="px-4 py-10 text-center text-[13px] text-ink-3">{session.items.length ? t('list.noMatches') : t('list.empty')}</li>
          )}
        </ul>
        <p className="flex items-center gap-1.5 border-t border-line px-4 py-2.5 text-[11.5px] text-ink-3">
          <ShieldCheck className="size-3.5 text-ok" />
          {t('list.footer', { count: session.items.length })}
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
          <EmptyState
            icon={<KeyRound />}
            title={session.items.length ? t('empty.select') : t('empty.first')}
            action={
              <Button variant="primary" icon={<Plus />} onClick={() => startNew('login')}>
                {t('empty.newLogin')}
              </Button>
            }
          >
            {t('empty.body')}
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
  const { t } = useTranslation('vault')
  const [reveal, setReveal] = useState(false)
  useEffect(() => {
    if (!reveal) return
    const timer = setTimeout(() => setReveal(false), 20_000)
    return () => clearTimeout(timer)
  }, [reveal])
  const safeUrl = item.url ? (/^https?:\/\//i.test(item.url) ? item.url : `https://${item.url}`) : ''

  return (
    <div className="animate-rise mx-auto w-full max-w-[620px] px-6 py-8 sm:px-10">
      <button type="button" onClick={onBack} className="mb-4 text-[13px] text-ink-3 hover:text-ink md:hidden">
        {t('back')}
      </button>
      <div className="flex items-start gap-4">
        <Monogram item={item} size={52} />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[26px] leading-tight font-medium tracking-[-0.02em] [overflow-wrap:anywhere]">{item.title}</h1>
          <p className="mt-1 text-[12.5px] text-ink-3">
            {item.type === 'login' ? t('detail.updatedLogin', { time: relativeTime(item.updatedAt) }) : t('detail.updatedNote', { time: relativeTime(item.updatedAt) })}
          </p>
        </div>
        <div className="flex gap-0.5">
          <Button variant="ghost" size="sm" iconOnly aria-label={item.favorite ? t('detail.unfavorite') : t('detail.favorite')} icon={<Star className={item.favorite ? 'fill-[var(--warn)] text-warn' : undefined} />} onClick={onToggleFavorite} />
          <Button variant="ghost" size="sm" iconOnly aria-label={t('detail.edit')} icon={<Pencil />} onClick={onEdit} />
          <Button variant="ghost" size="sm" iconOnly aria-label={t('detail.delete')} icon={<Trash />} onClick={onDelete} className="hover:text-danger" />
        </div>
      </div>

      <div className="mt-7 overflow-hidden rounded-[14px] border border-line bg-surface shadow-sm">
        {item.type === 'login' && (
          <>
            <DetailField label={t('detail.username')} actions={item.username ? <CopyButton value={item.username} label={t('detail.copyUsername')} message={t('detail.usernameCopied')} /> : null}>
              {item.username || <span className="text-ink-4">—</span>}
            </DetailField>
            <DetailField
              label={t('detail.password')}
              actions={
                item.password ? (
                  <>
                    <button type="button" onClick={() => setReveal((r) => !r)} aria-label={reveal ? t('detail.hidePassword') : t('detail.showPassword')} className="grid size-7 place-items-center rounded-[8px] text-ink-3 hover:bg-hover hover:text-ink">
                      {reveal ? <EyeOff className="size-[15px]" /> : <Eye className="size-[15px]" />}
                    </button>
                    <CopyButton value={item.password} label={t('detail.copyPassword')} clearAfterMs={CLIPBOARD_MS} message={t('detail.passwordCopied')} />
                  </>
                ) : null
              }
            >
              {item.password ? reveal ? <PasswordText value={item.password} className="text-[14.5px]" /> : <span className="font-mono tracking-[0.2em] text-ink-2">••••••••••••</span> : <span className="text-ink-4">—</span>}
            </DetailField>
            {item.totp && <TotpField value={item.totp} />}
            <DetailField
              label={t('detail.website')}
              actions={
                safeUrl ? (
                  <>
                    <a href={safeUrl} target="_blank" rel="noopener noreferrer" aria-label={t('detail.openWebsite')} className="grid size-7 place-items-center rounded-[8px] text-ink-3 hover:bg-hover hover:text-ink">
                      <ExternalLink className="size-[15px]" />
                    </a>
                    <CopyButton value={item.url} label={t('detail.copyUrl')} message={t('detail.urlCopied')} />
                  </>
                ) : null
              }
            >
              {item.url ? host(item.url) : <span className="text-ink-4">—</span>}
            </DetailField>
          </>
        )}
        <DetailField
          label={item.type === 'note' ? t('detail.content') : t('detail.notes')}
          actions={item.notes ? <CopyButton value={item.notes} label={t('detail.copyNotes')} clearAfterMs={CLIPBOARD_MS} message={t('detail.notesCopied')} /> : null}
        >
          {item.notes ? <p className="whitespace-pre-wrap">{item.notes}</p> : <span className="text-ink-4">—</span>}
        </DetailField>
      </div>
      <p className="mt-4 flex items-center gap-1.5 text-[12px] text-ink-3">
        <ShieldCheck className="size-3.5 text-ok" /> {t('detail.clipboardClears')}
      </p>
    </div>
  )
}

/** The current code, refreshed every second; computed here, never on the server. */
function TotpField({ value }: { value: string }) {
  const { t } = useTranslation('vault')
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
      <DetailField label={t('totp.label')}>
        <span className="text-danger">{t(`totp.problems.${config}`)}</span>
      </DetailField>
    )
  }
  return (
    <DetailField
      label={t('totp.label')}
      actions={current ? <CopyButton value={current.code} label={t('totp.copy')} clearAfterMs={CLIPBOARD_MS} message={t('totp.copied')} /> : null}
    >
      {current ? (
        <span className="flex items-center gap-3">
          <span aria-label={t('totp.current')} className="font-mono text-[18px] tracking-[0.12em] text-ink">
            {groupCode(current.code)}
          </span>
          <span className={cn('text-[12px] tabular-nums', current.remaining <= 5 ? 'text-warn' : 'text-ink-3')} aria-label={t('totp.changesIn', { count: current.remaining })}>
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
  const { t } = useTranslation(['vault', 'common'])
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
      setTotpError(t(`totp.problems.${problem}`))
      return
    }
    setBusy(true)
    await onSave(item)
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="animate-rise mx-auto flex w-full max-w-[620px] flex-col gap-4 px-6 py-8 sm:px-10">
      <h1 className="font-display text-[24px] font-medium">{initial.title ? t('editor.editTitle') : item.type === 'login' ? t('editor.newLogin') : t('editor.newNote')}</h1>
      <Field
        label={t('editor.name')}
        value={item.title}
        onChange={(e) => set('title', e.target.value)}
        placeholder={item.type === 'login' ? t('editor.namePlaceholderLogin') : t('editor.namePlaceholderNote')}
        autoFocus
        maxLength={ITEM_LIMITS.title}
      />
      {item.type === 'login' && (
        <>
          <Field label={t('editor.username')} value={item.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" spellCheck={false} maxLength={ITEM_LIMITS.username} />
          <Field
            label={t('editor.password')}
            type={show ? 'text' : 'password'}
            value={item.password}
            onChange={(e) => set('password', e.target.value)}
            autoComplete="new-password"
            spellCheck={false}
            className="[&_input]:pr-[72px] [&_input]:font-mono"
            maxLength={ITEM_LIMITS.password}
            trailing={
              <span className="flex items-center gap-0.5 pr-0.5">
                <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? t('reveal.hide') : t('reveal.show')} className="grid size-8 place-items-center rounded-[8px] text-ink-3 hover:bg-hover hover:text-ink">
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
                <Popover
                  open={genOpen}
                  onOpenChange={setGenOpen}
                  align="end"
                  className="w-[340px] p-4"
                  trigger={
                    <button type="button" aria-label={t('editor.generate')} title={t('editor.generate')} className="grid size-8 place-items-center rounded-[8px] text-ink-3 hover:bg-hover hover:text-ink">
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
          <Field
            label={t('editor.website')}
            value={item.url}
            onChange={(e) => set('url', e.target.value)}
            placeholder={t('editor.websitePlaceholder')}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            maxLength={ITEM_LIMITS.url}
          />
          <Field
            label={t('editor.totp')}
            value={item.totp}
            onChange={(e) => changeTotp(e.target.value)}
            placeholder={t('editor.totpPlaceholder')}
            hint={t('editor.totpHint')}
            error={totpError}
            autoComplete="off"
            spellCheck={false}
            className="[&_input]:font-mono"
            maxLength={ITEM_LIMITS.totp}
          />
        </>
      )}
      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium text-ink-2">{item.type === 'note' ? t('editor.content') : t('editor.notes')}</span>
        <textarea value={item.notes} onChange={(e) => set('notes', e.target.value)} rows={item.type === 'note' ? 10 : 4} maxLength={ITEM_LIMITS.notes} className="field h-auto resize-y py-2 leading-relaxed" />
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onCancel}>
          {t('common:actions.cancel')}
        </Button>
        <Button type="submit" variant="primary" loading={busy} icon={<ShieldCheck />}>
          {t('editor.save')}
        </Button>
      </div>
    </form>
  )
}

function ChangeMasterDialog({ open, onOpenChange, state }: { open: boolean; onOpenChange: (o: boolean) => void; state: VaultStateDTO }) {
  const { t } = useTranslation(['vault', 'common'])
  const { me } = useWorkspace()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (estimateMasterPassword(next).score === 0) return setError(t('master.newTooShort'))
    if (next !== confirm) return setError(t('master.mismatch'))
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
      toast.success(t('changeMaster.done'))
    } catch (err) {
      setError(err instanceof WrongSecretError ? t('changeMaster.wrongCurrent') : errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('changeMaster.title')} description={t('changeMaster.description')}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t('changeMaster.current')} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" autoFocus />
        <Field label={t('master.new')} type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" hint={estimateMasterPassword(next).hint} />
        <Field label={t('master.repeatNew')} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" error={error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!current || !next}>
            {t('changeMaster.submit')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
