import { Copy, Download } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { copyText } from '../../components/ui/CopyButton'

function downloadKey(accessKey: string) {
  const text = [
    'Orqevio — Clave de acceso',
    '',
    `Dirección: ${window.location.origin}`,
    `Clave: ${accessKey}`,
    '',
    'Guárdala en tu gestor de contraseñas. Sirve para entrar en esta copia de Orqevio desde cualquier dispositivo.',
    'Si la pierdes, quien administra la copia puede generar otra; no afecta a la contraseña maestra de la bóveda.',
    '',
  ].join('\n')
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'orqevio-clave-de-acceso.txt'
  a.click()
  URL.revokeObjectURL(url)
}

/** Shows a freshly issued access key once, and only lets the user continue after confirming it is saved. */
export function AccessKeyReveal({ accessKey, confirmLabel, onDone, busy }: { accessKey: string; confirmLabel: string; onDone: () => void; busy?: boolean }) {
  const [saved, setSaved] = useState(false)
  return (
    <div>
      <div className="rounded-[14px] border border-line bg-sunken p-4">
        {/* Wraps only between groups, so no group of four is ever split. */}
        <p aria-label="Clave de acceso" className="text-center font-mono text-[15.5px] leading-relaxed font-medium tracking-[0.06em] text-balance break-words text-ink select-all">
          {accessKey}
        </p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button icon={<Copy />} onClick={() => void copyText(accessKey, { message: 'Clave copiada' })}>
          Copiar
        </Button>
        <Button icon={<Download />} onClick={() => downloadKey(accessKey)}>
          Descargar .txt
        </Button>
      </div>
      <label className="mt-5 flex cursor-pointer items-start gap-3 text-[13px] text-ink-2">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
        La he guardado en un lugar seguro, por ejemplo en mi gestor de contraseñas.
      </label>
      <Button variant="primary" size="lg" className="mt-5 w-full" disabled={!saved} loading={busy} onClick={onDone}>
        {confirmLabel}
      </Button>
    </div>
  )
}
