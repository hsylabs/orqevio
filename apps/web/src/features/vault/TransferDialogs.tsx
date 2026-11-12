import { Download, FileUp, ShieldAlert, ShieldCheck } from 'lucide-react'
import { type FormEvent, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { Field } from '../../components/ui/Field'
import { Segmented } from '../../components/ui/Segmented'
import type { VaultStateDTO } from '@orqevio/shared'
import { errorMessage, put } from '../../lib/api'
import { plural } from '../../lib/format'
import { type EncryptedExport, WrongSecretError, encryptItem, openExport, sealExport, unlockWithPassword } from './crypto'
import { getSession, setSessionItems } from './session'
import { type ImportProblem, type ImportedItems, MAX_IMPORT_BYTES, readDecryptedExport, readImport, toBitwardenJson, withoutDuplicates } from './transfer'
import type { VaultItem } from './types'

const PROBLEMS: Record<ImportProblem, string> = {
  empty: 'El archivo está vacío.',
  unknown_format: 'No reconozco este archivo. Usa el CSV que exportan Chrome, Edge, Firefox o Safari, el CSV o el JSON de Bitwarden, o una copia de Orqevio.',
  bitwarden_encrypted: 'Es una exportación cifrada de Bitwarden. Expórtala de nuevo en formato «.json» o «.csv» sin cifrar e impórtala aquí.',
  no_items: 'El archivo no contiene credenciales ni notas.',
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const today = () => new Date().toISOString().slice(0, 10)

/** Encrypts and uploads items, a few at a time. Returns the ones the server accepted. */
async function upload(items: VaultItem[], onProgress: (done: number) => void) {
  const { key, userId } = getSession()
  if (!key || !userId) throw new Error('La bóveda está bloqueada.')
  const saved: VaultItem[] = []
  let failed = 0
  let next = 0
  async function worker() {
    while (next < items.length) {
      const item = items[next++]!
      try {
        await put(`/vault/items/${item.id}`, { data: await encryptItem(key!, userId!, item) })
        saved.push(item)
      } catch {
        failed++
      }
      onProgress(saved.length + failed)
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))
  return { saved, failed }
}

export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
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
      setError('El archivo es demasiado grande (más de 10 MB).')
      return
    }
    const outcome = readImport(await file.text())
    if (outcome.kind === 'problem') setError(PROBLEMS[outcome.problem])
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
      if (!imported) throw new Error('La copia está dañada.')
      setEncrypted(null)
      prepare(imported)
    } catch (err) {
      setError(err instanceof WrongSecretError ? 'No es la contraseña con la que se exportó esta copia.' : errorMessage(err))
    } finally {
      setBusy(false)
      setPassword('')
    }
  }

  async function run() {
    if (!review) return
    setBusy(true)
    try {
      const { saved, failed } = await upload(review.fresh, setProgress)
      const session = getSession()
      setSessionItems([...session.items, ...saved])
      if (failed) toast.error(`${plural(failed, 'elemento no se ha podido importar', 'elementos no se han podido importar')}. Vuelve a importar el archivo: los ya importados se omitirán.`)
      if (saved.length) toast.success(`${plural(saved.length, 'elemento importado', 'elementos importados')}`)
      onOpenChange(false)
      reset()
    } catch (err) {
      toast.error(errorMessage(err))
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
      title="Importar a la bóveda"
      description="El archivo se lee y se cifra en este navegador: el servidor solo recibe elementos ya cifrados."
    >
      <div className="flex flex-col gap-4">
        {!review && !encrypted && (
          <>
            <p className="text-[13px] leading-relaxed text-ink-2">
              Admite el CSV que exportan Chrome, Edge, Firefox y Safari, el CSV y el JSON sin cifrar de Bitwarden, y las copias cifradas de Orqevio.
            </p>
            <Button variant="secondary" icon={<FileUp />} onClick={() => input.current?.click()}>
              Elegir archivo
            </Button>
            <input
              ref={input}
              type="file"
              accept=".csv,.json,text/csv,application/json"
              hidden
              aria-label="Archivo para importar"
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
            <p className="text-[13px] leading-relaxed text-ink-2">
              Es una copia cifrada de Orqevio con {plural(encrypted.count, 'elemento', 'elementos')}. Escribe la contraseña maestra que tenías al exportarla.
            </p>
            <Field label="Contraseña de la copia" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" autoFocus />
            <Button type="submit" variant="primary" loading={busy} disabled={!password}>
              Descifrar
            </Button>
          </form>
        )}
        {review && (
          <>
            <div className="rounded-[12px] border border-line bg-surface p-4 text-[13.5px] leading-relaxed" role="status">
              <p className="font-medium">Desde {review.source}:</p>
              <ul className="mt-1.5 list-disc pl-5 text-ink-2">
                <li>
                  {[logins > 0 && plural(logins, 'credencial nueva', 'credenciales nuevas'), notes > 0 && plural(notes, 'nota nueva', 'notas nuevas')].filter(Boolean).join(' y ') ||
                    'Nada nuevo que importar'}
                </li>
                {review.duplicates > 0 && <li>{plural(review.duplicates, 'elemento ya estaba', 'elementos ya estaban')} en tu bóveda y se omite{review.duplicates === 1 ? '' : 'n'}</li>}
                {review.unsupported > 0 && <li>{plural(review.unsupported, 'elemento no es compatible', 'elementos no son compatibles')} (tarjetas o identidades) y no se importa{review.unsupported === 1 ? '' : 'n'}</li>}
              </ul>
            </div>
            {review.source !== 'Orqevio (cifrada)' && (
              <p className="flex gap-2 text-[12.5px] leading-relaxed text-ink-3">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warn" />
                El archivo que has elegido no está cifrado: bórralo de tu ordenador cuando termines.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={reset} disabled={busy}>
                Elegir otro
              </Button>
              <Button variant="primary" icon={<ShieldCheck />} loading={busy} disabled={!review.fresh.length} onClick={() => void run()}>
                {busy ? `Cifrando ${progress} de ${review.fresh.length}…` : `Importar ${plural(review.fresh.length, 'elemento', 'elementos')}`}
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
    const { userId, items } = getSession()
    if (!userId) return
    setBusy(true)
    setError(null)
    try {
      // Both kinds ask for the master password: whoever exports must know it.
      await unlockWithPassword(state, password, userId)
      const payload = JSON.stringify(toBitwardenJson(items), null, 2)
      if (kind === 'encrypted') download(`orqevio-boveda-cifrada-${today()}.json`, JSON.stringify(await sealExport(payload, password, items.length), null, 2))
      else download(`orqevio-boveda-sin-cifrar-${today()}.json`, payload)
      toast.success(`${plural(items.length, 'elemento exportado', 'elementos exportados')}`)
      close()
    } catch (err) {
      setError(err instanceof WrongSecretError ? 'Contraseña maestra incorrecta.' : errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : busy ? undefined : close())} title="Exportar la bóveda" description="Descarga todos tus elementos en un archivo, preparado en este navegador.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Segmented<ExportKind>
          label="Tipo de copia"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'encrypted', label: 'Cifrada' },
            { value: 'plain', label: 'Sin cifrar' },
          ]}
        />
        <p className="text-[13px] leading-relaxed text-ink-2">
          {kind === 'encrypted'
            ? 'Solo se abre con tu contraseña maestra actual. Sirve para guardar una copia de seguridad o pasarla a otra copia de Orqevio.'
            : 'En formato JSON de Bitwarden, que importan la mayoría de gestores de contraseñas. Cualquiera que tenga el archivo podrá leerlo.'}
        </p>
        <Field label="Contraseña maestra" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" error={error} />
        {kind === 'plain' && (
          <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-warn/40 bg-[color-mix(in_oklab,var(--warn)_8%,var(--sheet))] p-3 text-[13px] text-ink-2">
            <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
            Entiendo que el archivo no está cifrado y que cualquiera que lo tenga podrá leer todas mis contraseñas.
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" variant={kind === 'plain' ? 'danger' : 'primary'} icon={<Download />} loading={busy} disabled={!password || (kind === 'plain' && !understood)}>
            {kind === 'plain' ? 'Exportar sin cifrar' : 'Exportar cifrada'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
