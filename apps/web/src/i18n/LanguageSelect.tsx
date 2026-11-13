import { LOCALE_NAMES, type Locale } from '@orqevio/shared'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../lib/cn'
import { AVAILABLE_LOCALES, currentLocale } from '.'

/** The languages this build speaks, each named in its own language. */
export function LanguageSelect({ onChange, className, compact = false }: { onChange: (locale: Locale) => void; className?: string; compact?: boolean }) {
  const { t } = useTranslation()
  const id = useId()
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className={compact ? 'sr-only' : 'text-[12.5px] font-medium text-ink-2'}>
        {t('language')}
      </label>
      <select
        id={id}
        value={currentLocale()}
        onChange={(e) => onChange(e.target.value as Locale)}
        className={cn('field cursor-pointer', compact ? 'h-8 w-auto py-0 pr-8 text-[12.5px]' : 'h-10')}
      >
        {AVAILABLE_LOCALES.map((locale) => (
          <option key={locale} value={locale} lang={locale}>
            {LOCALE_NAMES[locale]}
          </option>
        ))}
      </select>
    </div>
  )
}
