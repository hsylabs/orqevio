import { addDays } from 'date-fns'
import { DayPicker } from 'react-day-picker'
import { useTranslation } from 'react-i18next'
import { Dialog } from '../../../components/ui/Dialog'
import { currentLocale } from '../../../i18n'
import { DATE_LOCALES } from '../../../lib/date-locales'
import '../../../styles/daypicker.css'

/**
 * A date written as text, for the «/» menu's «Date»: the Markdown keeps it as it is, and anyone (or
 * any agent) reads it. No reminder comes with it.
 */

/** A day as the app's language writes it in full: «28 de noviembre de 2026», «November 28, 2026». */
export const dateText = (date: Date, locale: string = currentLocale()) => new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(date)

/** «Today», «Tomorrow», «Yesterday», as the language says them. */
export function dayName(offset: number, locale: string = currentLocale()) {
  const name = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(offset, 'day')
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1)
}

/** Today, tomorrow and yesterday first, then any day of the calendar. Enter takes today. */
export function DateDialog({ open, onPick, onClose }: { open: boolean; onPick: (date: Date) => void; onClose: () => void }) {
  const { t } = useTranslation('docs')
  const locale = currentLocale()
  const today = new Date()
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()} title={t('editor.date.title')} width="max-w-[340px]">
      <div className="flex flex-wrap gap-1 pb-2">
        {[0, 1, -1].map((offset) => {
          const day = addDays(today, offset)
          return (
            <button
              key={offset}
              type="button"
              onClick={() => onPick(day)}
              title={dateText(day, locale)}
              // Today has the focus as it opens: Enter writes it.
              data-autofocus={offset === 0 || undefined}
              className="h-7 rounded-full bg-sunken px-2.5 text-[12px] font-medium text-ink-2 hover:bg-press hover:text-ink"
            >
              {dayName(offset, locale)}
            </button>
          )
        })}
      </div>
      <DayPicker
        mode="single"
        required
        selected={today}
        // Any day pressed, today included: a selection that stays as it is is still a choice.
        onDayClick={(day) => onPick(day)}
        locale={DATE_LOCALES[locale]}
        weekStartsOn={1}
        className="orq-daypicker"
        showOutsideDays
      />
    </Dialog>
  )
}
