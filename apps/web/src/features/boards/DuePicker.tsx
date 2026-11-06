import { addDays, nextMonday } from 'date-fns'
import { es } from 'date-fns/locale'
import { type ReactNode, useState } from 'react'
import { DayPicker } from 'react-day-picker'
import { Popover } from '../../components/ui/Popover'
import { dueToLocalDate, localDateToDue } from '../../lib/format'
import '../../styles/daypicker.css'

export function DuePicker({ value, onChange, trigger }: { value: string | null; onChange: (iso: string | null) => void; trigger: ReactNode }) {
  const [open, setOpen] = useState(false)
  const selected = value ? dueToLocalDate(value) : undefined
  const pick = (d: Date | null) => {
    onChange(d ? localDateToDue(d) : null)
    setOpen(false)
  }
  const today = new Date()
  const quick = [
    { label: 'Hoy', date: today },
    { label: 'Mañana', date: addDays(today, 1) },
    { label: 'Lunes', date: nextMonday(today) },
    { label: 'En 1 semana', date: addDays(today, 7) },
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
      <DayPicker mode="single" locale={es} weekStartsOn={1} selected={selected} defaultMonth={selected} onSelect={(d) => d && pick(d)} className="orq-daypicker" showOutsideDays />
      {value && (
        <button type="button" onClick={() => pick(null)} className="mt-1 w-full rounded-[8px] py-1.5 text-[12.5px] font-medium text-danger hover:bg-danger-soft">
          Quitar fecha
        </button>
      )}
    </Popover>
  )
}
