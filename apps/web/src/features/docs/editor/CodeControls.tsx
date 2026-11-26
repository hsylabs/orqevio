import type { Editor } from '@tiptap/core'
import { Selection, type SelectionBookmark, TextSelection, type Transaction } from '@tiptap/pm/state'
import { Command, defaultFilter } from 'cmdk'
import { Check, Search } from 'lucide-react'
import { Popover as P } from 'radix-ui'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { keepOpenOnOwnEscape } from '../../../lib/ime'
import { codeStorage } from './code-block'
import { LANGUAGES, PLAIN, findLanguage, languageOf, withLanguage } from './code-languages'
import { changeOf, followBlock, ownStep } from './own-step'

/** Accents and case never matter when searching. */
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const filter = (value: string, search: string, keywords?: string[]) => defaultFilter(fold(value), fold(search), keywords?.map(fold))

/** A word that can be a block's language: what a fence's info string starts with. */
const WORD = /^[\w#+.-]+$/
const PLAIN_ITEM = 'plain'

/**
 * The list of languages of a code block, opened from the language on its bar or from its menu
 * (Ctrl+/ → «Language…»): a search box and the languages, the current one ticked. A word the list
 * doesn't know can be used as it is, as a fence would have it (`mermaid`): shown, never coloured.
 */
export function CodeControls({ editor }: { editor: Editor }) {
  const { t } = useTranslation('docs')
  const [open, setOpen] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState('')
  /** The selection before the list opened, to bring back as it closes. */
  const before = useRef<SelectionBookmark | null>(null)
  const openRef = useRef<number | null>(null)
  openRef.current = open
  /** The block of the list last open, for its closing: `open` is already null by then. */
  const last = useRef<number | null>(null)
  if (open !== null) last.current = open
  /** Whether the list closes for a press elsewhere, which keeps the focus it gives. */
  const outside = useRef(false)

  useEffect(() => {
    const storage = codeStorage(editor)
    if (!storage) return
    storage.openLanguages = (pos) => {
      const node = editor.state.doc.nodeAt(pos)
      if (node?.type.name !== 'codeBlock') return
      // Its language again: the list closes, as a menu's button does.
      if (openRef.current === pos) return setOpen(null)
      outside.current = false
      before.current = editor.state.selection.getBookmark()
      setQuery('')
      setActive(currentItem(node.attrs.language as string | null))
      setOpen(pos)
    }
    // An agent or another tab can change the page while the list is open: it follows its block.
    const changed = (event: { transaction: Transaction; appendedTransactions?: Transaction[] }) => {
      const change = changeOf(event)
      if (!change.docChanged) return
      before.current = before.current?.map(change.mapping) ?? null
      const pos = last.current
      if (pos === null) return
      const moved = followBlock(change, pos)
      last.current = moved !== null && change.doc.nodeAt(moved)?.type.name === 'codeBlock' ? moved : null
      // Still open, it follows the block (closing as it chooses, it stays closed).
      const block = last.current
      setOpen((current) => (current === null ? null : block))
    }
    editor.on('transaction', changed)
    return () => {
      storage.openLanguages = null
      editor.off('transaction', changed)
    }
  }, [editor])

  const node = open !== null ? editor.state.doc.nodeAt(open) : null
  let anchor: HTMLElement | null = null
  try {
    const dom = open !== null ? editor.view.nodeDOM(open) : null
    anchor = dom instanceof HTMLElement ? dom.querySelector<HTMLElement>('.orq-code-lang') : null
  } catch {
    anchor = null
  }

  // The language on the bar says its list is open.
  useEffect(() => {
    if (!anchor) return
    anchor.setAttribute('aria-expanded', 'true')
    return () => anchor.setAttribute('aria-expanded', 'false')
  }, [anchor])

  const info = (node?.attrs.language as string | null | undefined) ?? null
  const current = currentItem(info)
  const word = query.trim()
  const custom = WORD.test(word) && !findLanguage(word) && !PLAIN.has(word.toLowerCase()) && word !== languageOf(info) ? word : null

  function choose(id: string) {
    const pos = open
    setOpen(null)
    // What the block already is stays as it was written: `ts` isn't made `typescript`.
    if (pos === null || !node || (id || PLAIN_ITEM) === current) return
    const next = withLanguage(info, id)
    if (next !== info) ownStep(editor, ({ tr }) => (tr.setNodeMarkup(pos, undefined, { ...node.attrs, language: next }), true), { focus: false })
  }

  /** As the list closes: the cursor where it was if it was in the block, at the end of its code otherwise. */
  function closeFocus(event: Event) {
    event.preventDefault()
    const bookmark = before.current
    before.current = null
    // Closed by a press elsewhere that took the focus (a field, the page's text): it stays there.
    // One on something that takes none (another block's copy button) leaves it to the editor.
    if (outside.current) {
      outside.current = false
      if (document.activeElement && document.activeElement !== document.body) return
    }
    const pos = last.current
    editor
      .chain()
      .focus(undefined, { scrollIntoView: false })
      .command(({ tr }) => {
        const block = pos !== null ? tr.doc.nodeAt(pos) : null
        let selection: Selection | null = null
        try {
          selection = bookmark?.resolve(tr.doc) ?? null
        } catch {
          selection = null
        }
        if (block?.type.name === 'codeBlock' && pos !== null) {
          const inside = selection && selection.from > pos && selection.to < pos + block.nodeSize
          if (!inside) selection = TextSelection.create(tr.doc, pos + block.nodeSize - 1)
        }
        if (selection) tr.setSelection(selection)
        return true
      })
      .run()
  }
  return (
    <P.Root open={open !== null && !!anchor} onOpenChange={(value) => !value && setOpen(null)}>
      <P.Anchor virtualRef={{ current: anchor ?? fallbackAnchor }} />
      <P.Portal>
        <P.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          aria-label={t('editor.code.picker')}
          onEscapeKeyDown={keepOpenOnOwnEscape}
          onInteractOutside={(event) => {
            // A press on the block's language is its own: it closes the list (see openLanguages).
            if (anchor && event.target instanceof Node && anchor.contains(event.target)) event.preventDefault()
            else outside.current = true
          }}
          onCloseAutoFocus={closeFocus}
          className="z-50 w-[264px] max-w-[calc(100vw-24px)] rounded-[14px] border border-line bg-surface p-1.5 shadow-lg outline-none print:hidden"
        >
          <Command label={t('editor.code.picker')} loop filter={filter} value={active} onValueChange={setActive}>
            <div className="flex items-center gap-2 rounded-[9px] bg-sunken px-2.5">
              <Search aria-hidden="true" className="size-[15px] shrink-0 text-ink-3" />
              <Command.Input
                autoFocus
                value={query}
                onValueChange={setQuery}
                placeholder={t('editor.code.search')}
                className="h-9 min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-ink-3"
              />
            </div>
            <Command.List className="mt-1 max-h-[min(300px,var(--radix-popover-content-available-height,300px))] overflow-y-auto">
              {!custom && <Command.Empty className="px-2.5 py-6 text-center text-[13px] text-ink-3">{t('editor.code.noResults')}</Command.Empty>}
              <Item value={PLAIN_ITEM} keywords={[t('editor.code.plain'), ...PLAIN]} current={current === PLAIN_ITEM} onSelect={() => choose('')}>
                {t('editor.code.plain')}
              </Item>
              {LANGUAGES.map((language) => (
                <Item key={language.id} value={language.id} keywords={[language.name, ...language.aliases]} current={current === language.id} onSelect={() => choose(language.id)}>
                  {language.name}
                </Item>
              ))}
              {custom && (
                <Item forceMount value={`use:${custom}`} current={false} onSelect={() => choose(custom)}>
                  {t('editor.code.use', { name: custom })}
                </Item>
              )}
            </Command.List>
          </Command>
        </P.Content>
      </P.Portal>
    </P.Root>
  )
}

/** The item of the list a block's info string is: its language, plain text, or none when the list doesn't know it. */
function currentItem(info: string | null) {
  const word = languageOf(info)
  if (!word || PLAIN.has(word.toLowerCase())) return PLAIN_ITEM
  return findLanguage(word)?.id ?? ''
}

/** Where the list would open without the block's bar: never shown, it opens only with one. */
const fallbackAnchor = { getBoundingClientRect: () => new DOMRect() }

function Item({ value, keywords, current, onSelect, forceMount, children }: { value: string; keywords?: string[]; current: boolean; onSelect: () => void; forceMount?: boolean; children: string }) {
  return (
    <Command.Item
      value={value}
      keywords={keywords}
      forceMount={forceMount}
      onSelect={onSelect}
      aria-current={current ? 'true' : undefined}
      className="flex h-8 cursor-default items-center gap-2 rounded-[8px] px-2.5 text-[13px] text-ink outline-none select-none data-[selected=true]:bg-hover"
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {current && <Check aria-hidden="true" className="size-[15px] shrink-0 text-accent" />}
    </Command.Item>
  )
}
