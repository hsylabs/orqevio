import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../lib/cn'
import { SlashPreview, hasSlashPreview } from './SlashPreview'
import { type SuggestionStore, useSuggestionState } from './suggestion-store'

/** Room between the menu and the preview beside it, and the preview's width. */
const GAP = 8
const PREVIEW_WIDTH = 216

/** Floating menu for "/" commands, "@" references and ":" emoji, positioned at the caret. */
export function SuggestionMenu({ store, emptyLabel }: { store: SuggestionStore; emptyLabel: string }) {
  const { t } = useTranslation('docs')
  const state = useSuggestionState(store)
  const ref = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [previewPos, setPreviewPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!state.open || !state.rect || !ref.current) return
    const menu = ref.current.getBoundingClientRect()
    const below = state.rect.bottom + 6
    const top = below + menu.height > window.innerHeight - 8 ? Math.max(8, state.rect.top - menu.height - 6) : below
    const left = Math.min(Math.max(8, state.rect.left - 4), window.innerWidth - menu.width - 8)
    setPos({ top, left })
  }, [state.open, state.rect, state.items.length])

  // Before the preview is placed beside it.
  useLayoutEffect(() => {
    list.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [state.index])

  const active = state.open && state.kind === 'slash' ? state.items[state.index] : undefined
  const previewed = active && hasSlashPreview(active.preview) ? active : undefined

  // Beside the menu, level with the option marked: on its right, or on its left where there is no room
  // on the right, and not at all where there is room on neither side (a phone).
  const placePreview = () => {
    const option = list.current?.querySelector<HTMLElement>('[data-active="true"]')
    if (!ref.current || !option || !previewRef.current || !pos) return setPreviewPos(null)
    const menu = ref.current.getBoundingClientRect()
    const height = previewRef.current.offsetHeight
    const top = Math.min(Math.max(8, option.getBoundingClientRect().top - 6), window.innerHeight - height - 8)
    const right = menu.right + GAP
    const left = menu.left - GAP - PREVIEW_WIDTH
    if (right + PREVIEW_WIDTH <= window.innerWidth - 8) setPreviewPos({ top, left: right })
    else if (left >= 8) setPreviewPos({ top, left })
    else setPreviewPos(null)
  }
  // Placed again whenever what it follows moves.
  useLayoutEffect(placePreview, [previewed?.id, pos, state.index]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!state.open) return null
  const showEmpty = state.items.length === 0
  // Only the «@» menu says what to type: the others are there only while something matches.
  if (showEmpty && state.kind !== 'mention') return null

  let lastGroup: string | undefined
  return createPortal(
    <>
      <div
        ref={ref}
        style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
        // Its own pointer events: a card's sheet, a modal dialog, takes them away from the rest of the page.
        className="animate-pop pointer-events-auto fixed z-50 flex w-[300px] flex-col overflow-hidden rounded-[14px] border border-line bg-surface shadow-lg"
        onMouseDown={(e) => e.preventDefault()}
        // Placed again once the menu has popped in to its full size.
        onAnimationEnd={placePreview}
      >
        <div
          ref={list}
          role="listbox"
          aria-label={t(`editor.menu.${state.kind}`)}
          className="max-h-[320px] overflow-y-auto p-1.5"
          onScroll={placePreview}
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
                    <span
                      className={cn(
                        'grid size-8 shrink-0 place-items-center rounded-[8px] border border-line bg-sheet',
                        state.kind === 'emoji' ? 'text-[18px] leading-none' : 'font-mono text-[12px] font-medium text-ink-2',
                      )}
                    >
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-ink">{item.title}</span>
                      {item.subtitle && <span className="block truncate text-[12px] text-ink-3">{item.subtitle}</span>}
                    </span>
                    {/* What typed at the start of a line makes the same: Markdown, as GitHub reads it. */}
                    {item.shortcut && (
                      <>
                        <kbd aria-hidden="true" className="kbd shrink-0">
                          {item.shortcut}
                        </kbd>
                        <span className="sr-only">{t('editor.menu.shortcut', { keys: item.shortcut })}</span>
                      </>
                    )}
                  </button>
                </div>
              )
            })
          )}
        </div>
        {state.kind === 'slash' && (
          // As Esc does: the menu goes, and what was typed stays.
          <button
            type="button"
            onClick={() => state.close?.()}
            className="flex items-center justify-between border-t border-line px-3.5 py-2 text-left text-[12.5px] text-ink-2 hover:bg-hover"
          >
            {t('editor.menu.close')}
            <kbd aria-hidden="true" className="kbd">
              Esc
            </kbd>
          </button>
        )}
      </div>
      {previewed && (
        <div
          ref={previewRef}
          aria-hidden="true"
          data-testid="slash-preview"
          style={{ top: previewPos?.top ?? -9999, left: previewPos?.left ?? -9999, width: PREVIEW_WIDTH, visibility: previewPos ? 'visible' : 'hidden' }}
          className="pointer-events-none fixed z-50 rounded-[12px] border border-line bg-surface p-2 shadow-lg"
        >
          <div className="overflow-hidden rounded-[8px] border border-line bg-sheet px-3.5 py-3">
            <SlashPreview id={previewed.preview!} />
          </div>
          {previewed.hint && <p className="px-1 pt-2 pb-0.5 text-[12px] leading-snug text-ink-2">{previewed.hint}</p>}
        </div>
      )}
    </>,
    document.body,
  )
}
