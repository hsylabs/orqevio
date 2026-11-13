import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../lib/cn'
import { type SuggestionStore, useSuggestionState } from './suggestion-store'

/** Floating menu for "/" commands and "@" references, positioned at the caret. */
export function SuggestionMenu({ store, emptyLabel }: { store: SuggestionStore; emptyLabel: string }) {
  const { t } = useTranslation('docs')
  const state = useSuggestionState(store)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!state.open || !state.rect || !ref.current) return
    const menu = ref.current.getBoundingClientRect()
    const below = state.rect.bottom + 6
    const top = below + menu.height > window.innerHeight - 8 ? Math.max(8, state.rect.top - menu.height - 6) : below
    const left = Math.min(Math.max(8, state.rect.left - 4), window.innerWidth - menu.width - 8)
    setPos({ top, left })
  }, [state.open, state.rect, state.items.length])

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [state.index])

  if (!state.open) return null
  const showEmpty = state.items.length === 0
  if (showEmpty && state.kind === 'slash') return null

  let lastGroup: string | undefined
  return createPortal(
    <div
      ref={ref}
      role="listbox"
      aria-label={state.kind === 'slash' ? t('editor.menu.slash') : t('editor.menu.mention')}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
      className="animate-pop fixed z-50 max-h-[320px] w-[300px] overflow-y-auto rounded-[14px] border border-line bg-surface p-1.5 shadow-lg"
      onMouseDown={(e) => e.preventDefault()}
    >
      {showEmpty ? (
        <p className="px-3 py-3 text-[12.5px] text-ink-3">{state.loading ? t('editor.menu.searching') : state.query ? t('editor.menu.noMatches') : emptyLabel}</p>
      ) : (
        state.items.map((item, i) => {
          const header = item.group && item.group !== lastGroup ? item.group : null
          lastGroup = item.group
          return (
            <div key={item.id}>
              {header && <p className="px-2.5 pt-2 pb-1 text-[10.5px] font-semibold tracking-[0.08em] text-ink-3 uppercase">{header}</p>}
              <button
                type="button"
                role="option"
                aria-selected={i === state.index}
                data-active={i === state.index}
                onMouseEnter={() => store.set({ index: i })}
                onClick={() => store.choose(i)}
                className={cn('flex w-full items-center gap-3 rounded-[9px] px-2 py-1.5 text-left', i === state.index && 'bg-hover')}
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-[8px] border border-line bg-sheet font-mono text-[12px] font-medium text-ink-2">{item.icon}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-medium text-ink">{item.title}</span>
                  {item.subtitle && <span className="block truncate text-[12px] text-ink-3">{item.subtitle}</span>}
                </span>
              </button>
            </div>
          )
        })
      )}
    </div>,
    document.body,
  )
}
