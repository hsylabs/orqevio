import { SmilePlus } from 'lucide-react'
import { useState } from 'react'
import { Popover } from '../../components/ui/Popover'

const ICONS = ['📄', '📝', '📌', '📎', '📚', '📖', '🧭', '🎯', '🚀', '💡', '🧪', '🛠️', '⚙️', '🔒', '🔑', '🗂️', '📁', '📊', '📈', '🗓️', '✅', '❗', '❓', '💬', '🧩', '🏁', '🌱', '🔥', '⭐', '🎨', '🧠', '🤖', '📦', '🧾', '🏷️', '🔗', '🌍', '🏠', '💼', '📣', '🛡️', '⏱️', '🎉', '🧑‍💻', '🗺️', '📐', '🔍', '✍️']

export function IconPicker({ value, onChange }: { value: string | null; onChange: (icon: string | null) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      className="w-[296px] p-2"
      trigger={
        value ? (
          <button type="button" aria-label="Cambiar icono" className="grid size-14 place-items-center rounded-[14px] text-[40px] leading-none transition-colors hover:bg-hover">
            {value}
          </button>
        ) : (
          <button type="button" className="flex h-7 items-center gap-1.5 rounded-[8px] px-2 text-[12.5px] text-ink-3 opacity-0 transition-opacity group-hover/title:opacity-100 hover:bg-hover hover:text-ink focus-visible:opacity-100 data-[state=open]:opacity-100">
            <SmilePlus className="size-4" />
            Añadir icono
          </button>
        )
      }
    >
      <div className="grid grid-cols-8 gap-0.5">
        {ICONS.map((icon) => (
          <button
            key={icon}
            type="button"
            onClick={() => {
              onChange(icon)
              setOpen(false)
            }}
            aria-label={`Usar ${icon}`}
            className="grid size-8 place-items-center rounded-[8px] text-[19px] hover:bg-hover"
          >
            {icon}
          </button>
        ))}
      </div>
      {value && (
        <button
          type="button"
          onClick={() => {
            onChange(null)
            setOpen(false)
          }}
          className="mt-2 w-full rounded-[8px] py-1.5 text-[12.5px] font-medium text-ink-3 hover:bg-hover hover:text-ink"
        >
          Quitar icono
        </button>
      )}
    </Popover>
  )
}
