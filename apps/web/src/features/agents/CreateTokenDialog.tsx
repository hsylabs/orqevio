import type { AccessLevel, CreatedTokenDTO } from '@orqevio/shared'
import { scopesFromLevels } from '@orqevio/shared'
import { ShieldAlert } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { CopyButton } from '../../components/ui/CopyButton'
import { Dialog } from '../../components/ui/Dialog'
import { Field } from '../../components/ui/Field'
import { Segmented } from '../../components/ui/Segmented'
import { errorMessage, post } from '../../lib/api'
import { keys, queryClient } from '../../lib/queries'
import { useWorkspace } from '../shell/workspace'
import { ConnectKit } from './ConnectKit'

const LEVELS: Array<{ value: AccessLevel; label: string }> = [
  { value: 'none', label: 'Sin acceso' },
  { value: 'read', label: 'Leer' },
  { value: 'write', label: 'Leer y escribir' },
]

export function CreateTokenDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { workspaceId, me } = useWorkspace()
  const [name, setName] = useState('')
  const [tasks, setTasks] = useState<AccessLevel>('write')
  const [docs, setDocs] = useState<AccessLevel>('read')
  const [expiry, setExpiry] = useState<'30' | '90' | '365' | 'never'>('90')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<CreatedTokenDTO | null>(null)
  const workspace = me.workspaces.find((w) => w.id === workspaceId)
  const scopes = scopesFromLevels({ tasks, docs })

  function close(o: boolean) {
    onOpenChange(o)
    if (!o) {
      setTimeout(() => {
        setCreated(null)
        setName('')
      }, 300)
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || scopes.length === 0) return
    setBusy(true)
    try {
      const token = await post<CreatedTokenDTO>('/tokens', {
        name: name.trim(),
        workspaceId,
        scopes,
        expiresInDays: expiry === 'never' ? null : Number(expiry),
      })
      setCreated(token)
      await queryClient.invalidateQueries({ queryKey: keys.tokens })
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  if (created) {
    return (
      <Dialog open={open} onOpenChange={close} title={`«${created.name}» está listo`} description="Copia el token ahora: por seguridad, solo guardamos su huella y no podrás volver a verlo." width="max-w-[640px]">
        <div className="flex items-center gap-2 rounded-[12px] border border-line bg-sunken py-2 pr-2 pl-3.5">
          <code className="min-w-0 flex-1 truncate font-mono text-[13px]">{created.token}</code>
          <CopyButton value={created.token} label="Copiar token" message="Token copiado" />
        </div>
        <div className="mt-5">
          <ConnectKit token={created.token} />
        </div>
        <div className="mt-5 flex justify-end">
          <Button variant="primary" onClick={() => close(false)}>
            Hecho
          </Button>
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={close} title="Conectar un agente" description={`Crea un token para «${workspace?.name ?? 'este espacio'}». Solo podrá acceder a este espacio y a lo que permitas aquí.`} width="max-w-[520px]">
      <form onSubmit={submit} className="flex flex-col gap-5">
        <Field label="Nombre del agente" value={name} onChange={(e) => setName(e.target.value)} placeholder="p. ej. Claude Code, Cursor, Asistente de soporte" autoFocus maxLength={60} />
        <div className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-4">
          <AccessRow label="Tareas" hint="Tableros, columnas, tarjetas y checklists" value={tasks} onChange={setTasks} />
          <div className="h-px bg-line" />
          <AccessRow label="Documentos" hint="Páginas y su contenido en Markdown" value={docs} onChange={setDocs} />
          <div className="h-px bg-line" />
          <div className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-[13.5px] font-medium">Bóveda</span>
              <span className="block text-[12px] text-ink-3">Nunca accesible para agentes</span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sunken px-2.5 py-1 text-[12px] font-medium text-ink-3">
              <ShieldAlert className="size-3.5" /> Bloqueada
            </span>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] font-medium text-ink-2">Caducidad</span>
          <Segmented
            size="sm"
            label="Caducidad"
            value={expiry}
            onChange={setExpiry}
            options={[
              { value: '30', label: '30 días' },
              { value: '90', label: '90 días' },
              { value: '365', label: '1 año' },
              { value: 'never', label: 'Nunca' },
            ]}
          />
        </div>
        {scopes.length === 0 && <p className="text-[12.5px] text-danger">Concede acceso de lectura al menos a un área.</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => close(false)}>
            Cancelar
          </Button>
          <Button type="submit" variant="agent" loading={busy} disabled={!name.trim() || scopes.length === 0}>
            Crear token
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

function AccessRow({ label, hint, value, onChange }: { label: string; hint: string; value: AccessLevel; onChange: (v: AccessLevel) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span>
        <span className="block text-[13.5px] font-medium">{label}</span>
        <span className="block text-[12px] text-ink-3">{hint}</span>
      </span>
      <Segmented size="sm" label={`Acceso a ${label}`} value={value} onChange={onChange} options={LEVELS} />
    </div>
  )
}
