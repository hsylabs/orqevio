import { Download, FileUp, ShieldAlert, ShieldCheck } from 'lucide-react'
import { type FormEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { Field } from '../../components/ui/Field'
import { Segmented } from '../../components/ui/Segmented'
import type { VaultStateDTO } from '@orqevio/shared'
import { errorMessage } from '../../lib/api'
import { formatList } from '../../lib/format'
import { type EncryptedExport, WrongSecretError, openExport, sealExport, unlockWithPassword } from './crypto'
import { getSession } from './session'
import { type ImportSource, type ImportedItems, MAX_IMPORT_BYTES, readDecryptedExport, readImport, toBitwardenJson, withoutDuplicates } from './transfer'
import type { VaultItem } from './types'
import { VaultLockedError, importItems } from './upload'

/** The summary's heading for each source, under `import.sources` in the catalog. */
const SOURCES = {
  'Chrome o Edge': 'chromeOrEdge',
  Firefox: 'firefox',
  Safari: 'safari',
  'Bitwarden (CSV)': 'bitwardenCsv',
  'Bitwarden (JSON)': 'bitwardenJson',
  CSV: 'csv',
  'Orqevio (cifrada)': 'orqevio',
} as const satisfies Record<ImportSource, string>

const MAX_IMPORT_MB = MAX_IMPORT_BYTES / 1024 / 1024

/** Saves `text` as a file; returns its size in bytes. */
function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return blob.size
}

const today = () => new Date().toISOString().slice(0, 10)

export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation('vault')
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [encrypted, setEncrypted] = useState<EncryptedExport | null>(null)
  const [password, setPassword] = useState('')
  const [review, setReview] = useState<(ImportedItems & { fresh: VaultItem[]; duplicates: number }) | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)

  function reset() {
    setError(null)
    setEncrypted(null)
    setPassword('')
    setReview(null)
    setProgress(0)
  }

  function prepare(imported: ImportedItems) {
    setReview({ ...imported, ...withoutDuplicates(imported.items, getSession().items) })
  }

  async function choose(file: File) {
    reset()
    if (file.size > MAX_IMPORT_BYTES) {
      setError(t('import.tooLarge', { size: MAX_IMPORT_MB }))
      return
    }
    const outcome = readImport(await file.text())
    if (outcome.kind === 'problem') setError(t(`import.problems.${outcome.problem}`))
    else if (outcome.kind === 'encrypted') setEncrypted(outcome.file)
    else prepare(outcome)
  }

  async function decrypt(e: FormEvent) {
    e.preventDefault()
    if (!encrypted) return
    setBusy(true)
    setError(null)
    try {
      const imported = readDecryptedExport(await openExport(encrypted, password))
      if (!imported) {
        setError(t('import.damaged'))
        return
      }
      setEncrypted(null)
      prepare(imported)
    } catch (err) {
      setError(err instanceof WrongSecretError ? t('import.wrongPassword') : errorMessage(err))
    } finally {
      setBusy(false)
      setPassword('')
    }
  }

  async function run() {
    if (!review) return
    setBusy(true)
    try {
      const { saved, failed } = await importItems(review.fresh, setProgress)
      if (failed) toast.error(t('import.failed', { count: failed }))
      if (saved) toast.success(t('import.done', { count: saved }))
      onOpenChange(false)
      reset()
    } catch (err) {
      toast.error(err instanceof VaultLockedError ? t('import.locked') : errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const logins = review?.fresh.filter((i) => i.type === 'login').length ?? 0
  const notes = (review?.fresh.length ?? 0) - logins
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return
        onOpenChange(next)
        if (!next) reset()
      }}
      title={t('import.title')}
      description={t('import.description')}
    >
      <div className="flex flex-col gap-4">
        {!review && !encrypted && (
          <>
            <p className="text-[13px] leading-relaxed text-ink-2">{t('import.formats')}</p>
            <Button variant="secondary" icon={<FileUp />} onClick={() => input.current?.click()}>
              {t('import.choose')}
            </Button>
            <input
              ref={input}
              type="file"
              accept=".csv,.json,text/csv,application/json"
              hidden
              aria-label={t('import.fileLabel')}
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) void choose(file)
              }}
            />
          </>
        )}
        {encrypted && (
          <form onSubmit={decrypt} className="flex flex-col gap-3">
            <p className="text-[13px] leading-relaxed text-ink-2">{t('import.encrypted', { count: encrypted.count })}</p>
            <Field label={t('import.exportPassword')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" autoFocus />
            <Button type="submit" variant="primary" loading={busy} disabled={!password}>
              {t('import.decrypt')}
            </Button>
          </form>
        )}
        {review && (
          <>
            <div className="rounded-[12px] border border-line bg-surface p-4 text-[13.5px] leading-relaxed" role="status">
              <p className="font-medium">{t(`import.sources.${SOURCES[review.source]}`)}</p>
              <ul className="mt-1.5 list-disc pl-5 text-ink-2">
                <li>
                  {formatList([logins > 0 && t('import.newLogins', { count: logins }), notes > 0 && t('import.newNotes', { count: notes })].filter((part) => part !== false)) ||
                    t('import.nothingNew')}
                </li>
                {review.duplicates > 0 && <li>{t('import.duplicates', { count: review.duplicates })}</li>}
                {review.unsupported > 0 && <li>{t('import.unsupported', { count: review.unsupported })}</li>}
              </ul>
            </div>
            {review.source !== 'Orqevio (cifrada)' && (
              <p className="flex gap-2 text-[12.5px] leading-relaxed text-ink-3">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warn" />
                {t('import.unencryptedWarning')}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={reset} disabled={busy}>
                {t('import.chooseAnother')}
              </Button>
              <Button variant="primary" icon={<ShieldCheck />} loading={busy} disabled={!review.fresh.length} onClick={() => void run()}>
                {busy ? t('import.progress', { done: progress, total: review.fresh.length }) : t('import.submit', { count: review.fresh.length })}
              </Button>
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}

type ExportKind = 'encrypted' | 'plain'

export function ExportDialog({ open, onOpenChange, state }: { open: boolean; onOpenChange: (open: boolean) => void; state: VaultStateDTO }) {
  const { t } = useTranslation(['vault', 'common'])
  const [kind, setKind] = useState<ExportKind>('encrypted')
  const [password, setPassword] = useState('')
  const [understood, setUnderstood] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function close() {
    onOpenChange(false)
    setPassword('')
    setUnderstood(false)
    setError(null)
    setKind('encrypted')
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const { key, userId, items } = getSession()
    if (!key || !userId) return
    setBusy(true)
    setError(null)
    try {
      // Both kinds ask for the master password: whoever exports must know it.
      await unlockWithPassword(state, password, userId)
      const payload = JSON.stringify(toBitwardenJson(items), null, 2)
      const text = kind === 'encrypted' ? JSON.stringify(await sealExport(payload, password, items.length), null, 2) : payload
      if (getSession().key !== key) throw new VaultLockedError()
      const size = download(kind === 'encrypted' ? t('export.fileNameEncrypted', { date: today() }) : t('export.fileNamePlain', { date: today() }), text)
      toast.success(t('export.done', { count: items.length }))
      if (size > MAX_IMPORT_BYTES) toast.warning(t('export.tooLarge', { size: MAX_IMPORT_MB }))
      close()
    } catch (err) {
      setError(err instanceof WrongSecretError ? t('master.wrong') : errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : busy ? undefined : close())} title={t('export.title')} description={t('export.description')}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Segmented<ExportKind>
          label={t('export.kind')}
          value={kind}
          onChange={setKind}
          options={[
            { value: 'encrypted', label: t('export.kinds.encrypted') },
            { value: 'plain', label: t('export.kinds.plain') },
          ]}
        />
        <p className="text-[13px] leading-relaxed text-ink-2">{kind === 'encrypted' ? t('export.encryptedInfo') : t('export.plainInfo')}</p>
        <Field label={t('master.label')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" error={error} />
        {kind === 'plain' && (
          <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-warn/40 bg-[color-mix(in_oklab,var(--warn)_8%,var(--sheet))] p-3 text-[13px] text-ink-2">
            <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
            {t('export.understood')}
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close} disabled={busy}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" variant={kind === 'plain' ? 'danger' : 'primary'} icon={<Download />} loading={busy} disabled={!password || (kind === 'plain' && !understood)}>
            {kind === 'plain' ? t('export.submitPlain') : t('export.submitEncrypted')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
