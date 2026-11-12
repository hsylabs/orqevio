import type { AccessLevel } from '@orqevio/shared'
import { ShieldAlert } from 'lucide-react'
import { Segmented } from '../../components/ui/Segmented'

const LEVELS: Array<{ value: AccessLevel; label: string }> = [
  { value: 'none', label: 'Sin acceso' },
  { value: 'read', label: 'Leer' },
  { value: 'write', label: 'Leer y escribir' },
]

/** What an agent may do in each area, as chosen when creating a token or approving an application. */
export function AccessRows({ tasks, docs, onTasks, onDocs }: { tasks: AccessLevel; docs: AccessLevel; onTasks: (v: AccessLevel) => void; onDocs: (v: AccessLevel) => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-4">
      <AccessRow label="Tareas" hint="Tableros, columnas, tarjetas y checklists" value={tasks} onChange={onTasks} />
      <div className="h-px bg-line" />
      <AccessRow label="Documentos" hint="Páginas y su contenido en Markdown" value={docs} onChange={onDocs} />
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
