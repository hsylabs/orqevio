import type { Locale } from '@orqevio/shared'
import { type Locale as DateLocale, addDays, nextMonday } from 'date-fns'
import { de, enUS, es, fr, it, ja, nl, ptBR } from 'date-fns/locale'
import { type ReactNode, useState } from 'react'
import { DayPicker } from 'react-day-picker'
import { useTranslation } from 'react-i18next'
import { Popover } from '../../components/ui/Popover'
import { currentLocale } from '../../i18n'
import { dueToLocalDate, localDateToDue } from '../../lib/format'
import '../../styles/daypicker.css'

/** The calendar's month and weekday names, in the language the app is showing. */
const DATE_LOCALES: Record<Locale, DateLocale> = { en: enUS, es, fr, pt: ptBR, it, de, nl, ja }

export function DuePicker({ value, onChange, trigger }: { value: string | null; onChange: (iso: string | null) => void; trigger: ReactNode }) {
  const { t } = useTranslation('boards')
  const [open, setOpen] = useState(false)
  const selected = value ? dueToLocalDate(value) : undefined
  const pick = (d: Date | null) => {
    onChange(d ? localDateToDue(d) : null)
    setOpen(false)
  }
  const today = new Date()
  const quick = [
    { label: t('due.today'), date: today },
    { label: t('due.tomorrow'), date: addDays(today, 1) },
    { label: t('due.monday'), date: nextMonday(today) },
    { label: t('due.inAWeek'), date: addDays(today, 7) },
  ]
  return (
    <Popover trigger={trigger} open={open} onOpenChange={setOpen} className="w-[300px]">
      <div className="flex flex-wrap gap-1 px-1 pb-2">
        {quick.map((q) => (
          <button key={q.label} type="button" onClick={() => pick(q.date)} className="h-7 rounded-full bg-sunken px-2.5 text-[12px] font-medium text-ink-2 hover:bg-press hover:text-ink">
            {q.label}
          </button>
        ))}
      </div>
      <DayPicker mode="single" locale={DATE_LOCALES[currentLocale()]} weekStartsOn={1} selected={selected} defaultMonth={selected} onSelect={(d) => d && pick(d)} className="orq-daypicker" showOutsideDays />
      {value && (
        <button type="button" onClick={() => pick(null)} className="mt-1 w-full rounded-[8px] py-1.5 text-[12.5px] font-medium text-danger hover:bg-danger-soft">
          {t('due.remove')}
        </button>
      )}
    </Popover>
  )
}
