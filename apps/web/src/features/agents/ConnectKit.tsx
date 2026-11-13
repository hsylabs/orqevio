import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CopyButton } from '../../components/ui/CopyButton'
import { cn } from '../../lib/cn'

export const mcpUrl = () => `${window.location.origin}/mcp`

/** Product names and file paths, never translated; a client without a file is set up from the terminal. */
const CLIENTS = [
  { id: 'claude-code', name: 'Claude Code' },
  { id: 'cursor', name: 'Cursor', file: '~/.cursor/mcp.json' },
  { id: 'vscode', name: 'VS Code', file: '.vscode/mcp.json' },
  { id: 'desktop', name: 'Claude Desktop', file: 'claude_desktop_config.json' },
] as const

function snippet(client: (typeof CLIENTS)[number]['id'], token: string) {
  const url = mcpUrl()
  switch (client) {
    case 'claude-code':
      return `claude mcp add --transport http orqevio ${url} \\\n  --header "Authorization: Bearer ${token}"`
    case 'cursor':
      return JSON.stringify({ mcpServers: { orqevio: { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2)
    case 'vscode':
      return JSON.stringify({ servers: { orqevio: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2)
    case 'desktop':
      return JSON.stringify(
        {
          mcpServers: {
            orqevio: {
              command: 'npx',
              args: ['-y', 'mcp-remote', url, '--header', 'Authorization:${ORQEVIO_AUTH}'],
              env: { ORQEVIO_AUTH: `Bearer ${token}` },
            },
          },
        },
        null,
        2,
      )
  }
}

/** Ready-to-paste configuration for common MCP clients. */
export function ConnectKit({ token }: { token: string }) {
  const { t } = useTranslation('agents')
  const [client, setClient] = useState<(typeof CLIENTS)[number]['id']>('claude-code')
  const current = CLIENTS.find((c) => c.id === client)!
  const code = snippet(client, token)
  return (
    <div>
      <div role="tablist" aria-label={t('kit.clients')} className="flex flex-wrap gap-1">
        {CLIENTS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={client === c.id}
            onClick={() => setClient(c.id)}
            className={cn('h-7.5 rounded-[8px] px-3 text-[12.5px] font-medium transition-colors', client === c.id ? 'bg-ink text-sheet' : 'text-ink-2 hover:bg-hover hover:text-ink')}
          >
            {c.name}
          </button>
        ))}
      </div>
      <div className="mt-2 overflow-hidden rounded-[12px] border border-line bg-[color-mix(in_oklab,var(--ink)_94%,var(--sheet))] text-[#ece8df] dark:bg-sunken">
        <div className="flex items-center justify-between border-b border-white/10 py-1.5 pr-1.5 pl-3.5 dark:border-line">
          <span className="font-mono text-[11.5px] opacity-60">{'file' in current ? current.file : t('kit.terminal')}</span>
          <CopyButton value={code.replace(/\\\n\s+/g, '')} label={t('kit.copy')} message={t('kit.copied')} className="text-current opacity-70 hover:bg-white/10 hover:text-current dark:hover:bg-hover" />
        </div>
        <pre className="overflow-x-auto p-3.5 font-mono text-[12px] leading-relaxed dark:text-ink">
          <code>{code}</code>
        </pre>
      </div>
      <p className="mt-2 text-[12px] text-ink-3">{client === 'desktop' ? t('kit.desktopNote') : t('kit.httpNote')}</p>
    </div>
  )
}
