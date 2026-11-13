import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { Code, ExternalLink, Link2, Strikethrough, X } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { cn } from '../../../lib/cn'

const SAFE = /^(https?:\/\/|mailto:|\/(?!\/))/i

/** Selection toolbar: inline formatting and link editing. */
export function FormatMenu({ editor }: { editor: Editor }) {
  const { t } = useTranslation(['docs', 'common'])
  const navigate = useNavigate()
  const [editingLink, setEditingLink] = useState(false)
  const [href, setHref] = useState('')
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      link: e.isActive('link'),
      href: (e.getAttributes('link').href as string | undefined) ?? '',
      empty: e.state.selection.empty,
    }),
  })

  useEffect(() => {
    if (!state.link) setEditingLink(false)
  }, [state.link])

  function saveLink(e: FormEvent) {
    e.preventDefault()
    let value = href.trim()
    if (!value) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    } else {
      if (!SAFE.test(value)) value = `https://${value}`
      editor.chain().focus().extendMarkRange('link').setLink({ href: value }).run()
    }
    setEditingLink(false)
  }

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: e, state: s }) => e.isEditable && (!s.selection.empty || e.isActive('link')) && !e.isActive('codeBlock') && !e.isActive('image')}
      options={{ placement: 'top', offset: 8 }}
      className="z-40"
    >
      <div className="animate-pop flex items-center gap-0.5 rounded-[12px] border border-line bg-surface p-1 shadow-lg" onMouseDown={(e) => e.preventDefault()}>
        {editingLink ? (
          <form onSubmit={saveLink} className="flex items-center gap-1" onMouseDown={(e) => e.stopPropagation()}>
            <input
              autoFocus
              value={href}
              onChange={(e) => setHref(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setEditingLink(false)}
              placeholder={t('editor.format.linkPlaceholder')}
              aria-label={t('editor.format.linkLabel')}
              className="h-7 w-[240px] rounded-[7px] bg-sunken px-2 text-[13px] outline-none"
            />
            <button type="submit" className="h-7 rounded-[7px] bg-ink px-2.5 text-[12px] font-medium text-sheet">
              {t('common:actions.save')}
            </button>
          </form>
        ) : state.empty && state.link ? (
          <>
            <span className="max-w-[220px] truncate px-2 font-mono text-[12px] text-ink-2">{state.href}</span>
            <Tool
              label={t('editor.format.openLink')}
              onClick={() => (/^\/(card|doc)\//.test(state.href) ? navigate(state.href) : window.open(state.href, '_blank', 'noopener,noreferrer'))}
            >
              <ExternalLink />
            </Tool>
            <Tool
              label={t('editor.format.editLink')}
              onClick={() => {
                setHref(state.href)
                setEditingLink(true)
              }}
            >
              <Link2 />
            </Tool>
            <Tool label={t('editor.format.removeLink')} onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}>
              <X />
            </Tool>
          </>
        ) : (
          <>
            <Tool label={t('editor.format.bold')} active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
              <span className="font-sans text-[14px] font-bold">B</span>
            </Tool>
            <Tool label={t('editor.format.italic')} active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
              <span className="font-display text-[15px] italic">i</span>
            </Tool>
            <Tool label={t('editor.format.strike')} active={state.strike} onClick={() => editor.chain().focus().toggleStrike().run()}>
              <Strikethrough />
            </Tool>
            <Tool label={t('editor.format.code')} active={state.code} onClick={() => editor.chain().focus().toggleCode().run()}>
              <Code />
            </Tool>
            <span className="mx-0.5 h-5 w-px bg-line" />
            <Tool
              label={t('editor.format.link')}
              active={state.link}
              onClick={() => {
                setHref(state.href)
                setEditingLink(true)
              }}
            >
              <Link2 />
            </Tool>
          </>
        )}
      </div>
    </BubbleMenu>
  )
}

function Tool({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn('grid h-7 min-w-7 place-items-center rounded-[7px] px-1 text-ink-2 transition-colors hover:bg-hover hover:text-ink [&_svg]:size-[15px]', active && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent')}
    >
      {children}
    </button>
  )
}
