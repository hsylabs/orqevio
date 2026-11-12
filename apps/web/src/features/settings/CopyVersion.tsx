import type { UpdateStatusDTO } from '@orqevio/shared'
import { ArrowUpRight, Sparkles } from 'lucide-react'
import { CopyButton } from '../../components/ui/CopyButton'
import { useUpdates } from '../../lib/queries'

/** How each kind of copy updates (see "Actualizaciones" in the README). */
function howToUpdate(status: UpdateStatusDTO): { text: string; command?: string } {
  switch (status.install) {
    case 'cli':
    case 'cloudflare': {
      const name = status.copyName && status.copyName !== 'orqevio' ? ` --name ${status.copyName}` : ''
      return { text: 'Ejecuta en tu ordenador:', command: `npx create-orqevio@latest update${name}` }
    }
    case 'button':
      return { text: 'Fusiona el pull request de Dependabot en el repositorio de tu copia; al hacerlo se despliega sola. Si no lo ves, sube la versión de create-orqevio en su package.json.' }
    case 'docker':
      return { text: 'En la carpeta de tu copia:', command: 'docker compose pull && docker compose up -d' }
    default:
      return { text: 'En el repositorio, y después reinicia el servidor:', command: 'git pull && pnpm install && pnpm build' }
  }
}

/** Version of this copy and, when there is one, the newer version with how to install it. */
export function CopyVersion() {
  const { data: status } = useUpdates()
  if (!status) return null
  const how = howToUpdate(status)
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[14px]">
        Orqevio <span className="font-mono text-[13px]">{status.current}</span>
        {status.latest && !status.updateAvailable && <span className="text-ink-3"> · Tienes la última versión.</span>}
      </p>
      {status.updateAvailable && (
        <div role="status" className="flex flex-col gap-3 rounded-[12px] border border-accent/40 bg-[color-mix(in_oklab,var(--accent)_8%,var(--sheet))] p-4">
          <p className="flex items-center gap-2 text-[14px] font-medium">
            <Sparkles className="size-4 text-accent" />
            Hay una versión nueva: {status.latest}
          </p>
          <p className="text-[13px] leading-relaxed text-ink-2">{how.text}</p>
          {how.command && (
            <div className="flex items-center gap-2 rounded-[10px] border border-line bg-surface py-1 pr-1 pl-3">
              <code className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{how.command}</code>
              <CopyButton value={how.command} label="Copiar la orden" message="Orden copiada" />
            </div>
          )}
          <p className="text-[12.5px] text-ink-3">Tus datos, tu clave y tu bóveda se conservan.</p>
          {status.releaseUrl && (
            <a href={status.releaseUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 self-start text-[13px] font-medium text-accent hover:underline">
              Ver las novedades
              <ArrowUpRight className="size-3.5" />
            </a>
          )}
        </div>
      )}
    </div>
  )
}
