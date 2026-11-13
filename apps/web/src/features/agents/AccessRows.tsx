import type { AccessLevel } from '@orqevio/shared'
import { ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Segmented } from '../../components/ui/Segmented'

const LEVELS: AccessLevel[] = ['none', 'read', 'write']

/** What an agent may do in each area, as chosen when creating a token or approving an application. */
export function AccessRows({ tasks, docs, onTasks, onDocs }: { tasks: AccessLevel; docs: AccessLevel; onTasks: (v: AccessLevel) => void; onDocs: (v: AccessLevel) => void }) {
  const { t } = useTranslation('agents')
  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-4">
      <AccessRow area="tasks" value={tasks} onChange={onTasks} />
      <div className="h-px bg-line" />
      <AccessRow area="docs" value={docs} onChange={onDocs} />
      <div className="h-px bg-line" />
      <div className="flex items-center justify-between gap-3">
        <span>
          <span className="block text-[13.5px] font-medium">{t('access.vault.label')}</span>
          <span className="block text-[12px] text-ink-3">{t('access.vault.hint')}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-sunken px-2.5 py-1 text-[12px] font-medium text-ink-3">
          <ShieldAlert className="size-3.5" /> {t('access.vault.blocked')}
        </span>
      </div>
    </div>
  )
}

function AccessRow({ area, value, onChange }: { area: 'tasks' | 'docs'; value: AccessLevel; onChange: (v: AccessLevel) => void }) {
  const { t } = useTranslation('agents')
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span>
        <span className="block text-[13.5px] font-medium">{t(`access.${area}.label`)}</span>
        <span className="block text-[12px] text-ink-3">{t(`access.${area}.hint`)}</span>
      </span>
      <Segmented size="sm" label={t(`access.${area}.group`)} value={value} onChange={onChange} options={LEVELS.map((level) => ({ value: level, label: t(`access.levels.${level}`) }))} />
    </div>
  )
}
