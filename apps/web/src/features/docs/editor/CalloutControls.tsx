import type { Editor } from '@tiptap/core'
import { Selection, type SelectionBookmark, type Transaction } from '@tiptap/pm/state'
import { Eraser, Info, Lightbulb, MessageSquareWarning, OctagonAlert, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from '../../../components/ui/Menu'
import { CALLOUT_TYPES, type CalloutType, calloutStorage, calloutType } from './callout'
import { removeCallout, setCalloutType } from './block-commands'
import { changeOf, followBlock } from './own-step'

export const CALLOUT_MENU_ICONS: Record<CalloutType, typeof Info> = { note: Info, tip: Lightbulb, important: MessageSquareWarning, warning: TriangleAlert, caution: OctagonAlert }

/** The types of a callout, the current one ticked, and taking the callout away: for its title's menu and the block's. */
export function CalloutTypeItems({ editor, pos, onAct }: { editor: Editor; pos: number; onAct?: () => void }) {
  const { t } = useTranslation('docs')
  const current = calloutType(editor.state.doc.nodeAt(pos)?.attrs.marker)
  return (
    <>
      {CALLOUT_TYPES.map((type) => {
        const Icon = CALLOUT_MENU_ICONS[type]
        return (
          <MenuItem
            key={type}
            icon={<Icon className={`orq-callout-menu-icon orq-callout--${type}`} />}
            current={type === current}
            disabled={type === current}
            onSelect={() => {
              onAct?.()
              setCalloutType(editor, pos, type)
            }}
          >
            {t(`editor.callout.${type}`)}
          </MenuItem>
        )
      })}
      <MenuSeparator />
      <MenuItem
        icon={<Eraser />}
        onSelect={() => {
          onAct?.()
          removeCallout(editor, pos)
        }}
      >
        {t('editor.callout.remove')}
      </MenuItem>
    </>
  )
}

/**
 * The menu of a callout's title: its types and taking it away. Opened from the title's button, it
 * opens under it; the cursor stays in the callout, or goes back where it was.
 */
export function CalloutControls({ editor }: { editor: Editor }) {
  const { t } = useTranslation('docs')
  const root = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<number | null>(null)
  const openRef = useRef<number | null>(null)
  openRef.current = open
  /** The callout of the menu last open, for its closing: `open` is already null by then. */
  const last = useRef<number | null>(null)
  if (open !== null) last.current = open
  const before = useRef<SelectionBookmark | null>(null)
  /** Whether an item ran: the cursor then goes into the callout, not back where it was. */
  const acted = useRef(false)

  useEffect(() => {
    const storage = calloutStorage(editor)
    if (!storage) return
    storage.openTypes = (pos) => {
      if (editor.state.doc.nodeAt(pos)?.type.name !== 'callout') return
      if (openRef.current === pos) return setOpen(null)
      before.current = editor.state.selection.getBookmark()
      acted.current = false
      setOpen(pos)
    }
    // An agent or another tab can change the page while the menu is open: it follows its callout.
    const changed = (event: { transaction: Transaction; appendedTransactions?: Transaction[] }) => {
      const change = changeOf(event)
      if (!change.docChanged) return
      before.current = before.current?.map(change.mapping) ?? null
      const pos = last.current
      if (pos === null) return
      const moved = followBlock(change, pos)
      last.current = moved !== null && change.doc.nodeAt(moved)?.type.name === 'callout' ? moved : null
      const block = last.current
      setOpen((current) => (current === null ? null : block))
    }
    editor.on('transaction', changed)
    return () => {
      storage.openTypes = null
      editor.off('transaction', changed)
    }
  }, [editor])

  const button = (() => {
    if (open === null) return null
    try {
      const dom = editor.view.nodeDOM(open)
      return dom instanceof HTMLElement ? dom.querySelector<HTMLElement>('.orq-callout-type') : null
    } catch {
      return null
    }
  })()

  // The title's button says its menu is open.
  useEffect(() => {
    if (!button) return
    button.setAttribute('aria-expanded', 'true')
    return () => button.setAttribute('aria-expanded', 'false')
  }, [button])

  /**
   * As the menu closes: the cursor back where it was. After a new type, in the callout: where it was
   * if it was in it, at the end of its text otherwise; taken away, where the change left it.
   */
  function closeFocus(event: Event) {
    event.preventDefault()
    const bookmark = before.current
    before.current = null
    const ran = acted.current
    acted.current = false
    const pos = last.current
    editor
      .chain()
      .focus(undefined, { scrollIntoView: false })
      .command(({ tr }) => {
        const callout = pos !== null ? tr.doc.nodeAt(pos) : null
        if (ran && callout?.type.name !== 'callout') return true
        let selection: Selection | null = null
        try {
          selection = bookmark?.resolve(tr.doc) ?? null
        } catch {
          selection = null
        }
        if (ran && callout && pos !== null) {
          const inside = selection && selection.from > pos && selection.to < pos + callout.nodeSize
          if (!inside) selection = Selection.findFrom(tr.doc.resolve(pos + callout.nodeSize - 1), -1, true)
        }
        if (selection) tr.setSelection(selection)
        return true
      })
      .run()
  }

  let rect: { top: number; left: number; width: number; height: number } | null = null
  if (button && root.current) {
    const base = root.current.getBoundingClientRect()
    const box = button.getBoundingClientRect()
    rect = { top: box.top - base.top, left: box.left - base.left, width: box.width, height: box.height }
  }

  return (
    <div ref={root} className="pointer-events-none absolute inset-0 z-30 print:hidden">
      {open !== null && rect && (
        <div className="absolute" style={rect}>
          <MenuRoot open onOpenChange={(value) => !value && setOpen(null)}>
            <MenuTrigger asChild>
              <span aria-hidden="true" aria-label={t('editor.callout.menu')} className="pointer-events-none absolute inset-0" />
            </MenuTrigger>
            <MenuContent align="start" onCloseAutoFocus={closeFocus}>
              <CalloutTypeItems editor={editor} pos={open} onAct={() => (acted.current = true)} />
            </MenuContent>
          </MenuRoot>
        </div>
      )}
    </div>
  )
}
