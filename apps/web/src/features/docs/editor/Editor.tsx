import type { AttachmentDTO, MeDTO, SearchResultDTO } from '@orqevio/shared'
import { cardHref, docHref } from '@orqevio/shared'
import type { Editor as TiptapEditor } from '@tiptap/core'
import { Placeholder } from '@tiptap/extensions'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Selection } from '@tiptap/pm/state'
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { ApiError, api, errorMessage, get } from '../../../lib/api'
import { cn } from '../../../lib/cn'
import { keys, queryClient } from '../../../lib/queries'
import { BlockControls } from './BlockControls'
import { CalloutControls } from './CalloutControls'
import { markerFor } from './callout'
import { insertToggle, outOfTitle } from './toggle'
import { CodeControls } from './CodeControls'
import { ImageControls } from './ImageControls'
import { MathControls } from './MathControls'
import { MathKeys, startMath } from './math'
import { FormatMenu } from './FormatMenu'
import { BlockKeys, Mentions, SlashCommands } from './extensions'
import { MARKDOWN_SHORTCUTS } from './block-commands'
import { documentExtensions } from './markdown'
import { SuggestionMenu } from './SuggestionMenu'
import { TableControls } from './TableControls'
import { type MenuItem, createSuggestionStore } from './suggestion-store'
import '../../../styles/editor.css'

export interface UploadTarget {
  type: 'page' | 'card'
  id: string
}

interface EditorProps {
  content: string
  onChange: (markdown: string) => void
  placeholder?: string
  workspaceId: string
  upload?: UploadTarget
  compact?: boolean
  autofocus?: boolean
  onReady?: (editor: TiptapEditor) => void
  onUploaded?: (attachment: AttachmentDTO) => void
  className?: string
  ariaLabel?: string
  /** The id of what tells more about the field (a hint with its keyboard shortcut). */
  ariaDescribedBy?: string
  /** The handle of each block, to move it and turn it into another; not in a short text such as a comment. */
  blockHandles?: boolean
}

type SlashId = 'p' | 'h1' | 'h2' | 'h3' | 'ul' | 'ol' | 'todo' | 'quote' | 'callout' | 'toggle' | 'code' | 'math' | 'inlineMath' | 'table' | 'hr' | 'mention' | 'image' | 'file'
type SlashGroup = 'blocks' | 'lists' | 'insert'

export async function uploadFile(file: File, target: UploadTarget): Promise<AttachmentDTO> {
  // The server refuses oversized files before reading them, which browsers report as a
  // network error; checking first gives the real reason.
  const limit = queryClient.getQueryData<MeDTO>(keys.me)?.limits.maxUploadBytes
  // A copy before 1.2.1 with MAX_UPLOAD_MB set wrong gives no number: the server decides then.
  if (typeof limit === 'number' && file.size > limit) throw new ApiError(413, 'file_too_large', 'File too large')
  return api<AttachmentDTO>('POST', `/${target.type === 'page' ? 'pages' : 'cards'}/${target.id}/attachments`, file)
}

/** Where the text ends: before the empty paragraph the editor keeps after anything but a paragraph at the end. */
function textEnd(doc: PMNode) {
  const last = doc.lastChild
  const kept = doc.childCount > 1 && last?.type.name === 'paragraph' && last.content.size === 0 && doc.child(doc.childCount - 2).type.name !== 'paragraph'
  return Selection.near(doc.resolve(kept ? doc.content.size - last.nodeSize : doc.content.size), -1)
}

/** Inserts the file where it was dropped (`pos`) or at the cursor, and returns the position right after it. */
function insertAttachment(editor: TiptapEditor, attachment: AttachmentDTO, pos?: number) {
  const content = attachment.isImage
    ? { type: 'image', attrs: { src: attachment.url, alt: attachment.filename } }
    : { type: 'paragraph', content: [{ type: 'text', text: attachment.filename, marks: [{ type: 'link', attrs: { href: attachment.url } }] }] }
  const chain = editor.chain().focus()
  // A toggle's title holds only text: the file goes under it, or after the toggle when it is closed.
  const at = outOfTitle(editor.state.doc, pos ?? editor.state.selection.from)
  if (pos === undefined && at === editor.state.selection.from) {
    chain.insertContent(content).run()
    return undefined
  }
  // Inserting leaves the cursor right after what it inserted.
  chain.insertContentAt(at, content).run()
  return pos === undefined ? undefined : editor.state.selection.to
}

export function Editor({ content, onChange, placeholder, workspaceId, upload, compact, autofocus, onReady, onUploaded, className, ariaLabel, ariaDescribedBy, blockHandles = true }: EditorProps) {
  const { t } = useTranslation('docs')
  // TipTap keeps the callbacks it was created with: they read the current language and placeholder from refs.
  const tRef = useRef(t)
  tRef.current = t
  const placeholderRef = useRef(placeholder)
  placeholderRef.current = placeholder
  const navigate = useNavigate()
  const slashStore = useMemo(createSuggestionStore, [])
  const mentionStore = useMemo(createSuggestionStore, [])
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  /** The Markdown last loaded or reported as changed. */
  const emitted = useRef('')
  const uploadRef = useRef(upload)
  uploadRef.current = upload
  const onUploadedRef = useRef(onUploaded)
  onUploadedRef.current = onUploaded
  const fileInput = useRef<HTMLInputElement>(null)
  const pendingUploadKind = useRef<'image' | 'file'>('image')

  async function handleFiles(editor: TiptapEditor, files: File[], pos?: number) {
    const target = uploadRef.current
    if (!target) return false
    const t = tRef.current
    for (const file of files) {
      const id = toast.loading(t('editor.uploading', { name: file.name }))
      try {
        const attachment = await uploadFile(file, target)
        // Each one after the previous, in the order they were dropped.
        pos = insertAttachment(editor, attachment, pos)
        onUploadedRef.current?.(attachment)
        toast.success(t('editor.uploaded'), { id })
      } catch (error) {
        // By name, as on a card: with several files dropped, which one did not go up.
        toast.error(`${file.name}: ${errorMessage(error)}`, { id })
      }
    }
    return true
  }

  const slashItems = (query: string): MenuItem[] => {
    const t = tRef.current
    const item = (id: SlashId, icon: string, group: SlashGroup, run: MenuItem['run']): MenuItem & { keywords: string } => ({
      id,
      title: t(`editor.slash.${id}.title`),
      subtitle: t(`editor.slash.${id}.subtitle`),
      icon,
      group: t(`editor.groups.${group}`),
      keywords: t(`editor.slash.${id}.keywords`),
      shortcut: MARKDOWN_SHORTCUTS[id as keyof typeof MARKDOWN_SHORTCUTS],
      run,
    })
    const items: Array<MenuItem & { keywords: string }> = [
      item('p', 'T', 'blocks', (e, r) => e.chain().focus().deleteRange(r).setParagraph().run()),
      item('h1', 'H1', 'blocks', (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run()),
      item('h2', 'H2', 'blocks', (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run()),
      item('h3', 'H3', 'blocks', (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run()),
      item('ul', '•', 'lists', (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run()),
      item('ol', '1.', 'lists', (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run()),
      item('todo', '☑', 'lists', (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run()),
      item('quote', '❝', 'blocks', (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run()),
      item('callout', 'ⓘ', 'blocks', (e, r) => e.chain().focus().deleteRange(r).wrapIn('callout', { marker: markerFor('note') }).run()),
      item('toggle', '▸', 'blocks', (e, r) => e.chain().focus().deleteRange(r).command(({ tr }) => insertToggle(tr)).run()),
      item('code', '</>', 'blocks', (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run()),
      item('math', '∑', 'blocks', (e, r) => startMath(e, r, true)),
      item('inlineMath', '√x', 'insert', (e, r) => startMath(e, r, false)),
      item('table', '▦', 'insert', (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()),
      item('hr', '—', 'insert', (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run()),
      item('mention', '@', 'insert', (e, r) => e.chain().focus().deleteRange(r).insertContent('@').run()),
    ]
    if (uploadRef.current) {
      items.push(
        item('image', '▣', 'insert', (e, r) => { e.chain().focus().deleteRange(r).run(); pendingUploadKind.current = 'image'; fileInput.current?.click() }),
        item('file', '⎘', 'insert', (e, r) => { e.chain().focus().deleteRange(r).run(); pendingUploadKind.current = 'file'; fileInput.current?.click() }),
      )
    }
    const q = query.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
    return items.filter((i) => !q || `${i.title} ${i.keywords}`.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').includes(q))
  }

  const mentionItems = async (query: string): Promise<MenuItem[]> => {
    if (query.trim().length === 0) return []
    const t = tRef.current
    try {
      const results = await get<SearchResultDTO[]>(`/workspaces/${workspaceId}/search?q=${encodeURIComponent(query.trim())}`)
      return results.slice(0, 8).map((r) => ({
        id: `${r.type}-${r.id}`,
        title: r.title || t('untitled', { ns: 'common' }),
        subtitle: r.type === 'card' ? t('editor.mention.card', { board: r.boardName, column: r.columnName }) : t('editor.mention.page', { project: r.projectName }),
        icon: r.type === 'card' ? '▤' : (r.icon ?? '¶'),
        group: r.type === 'card' ? t('editor.groups.tasks') : t('editor.groups.pages'),
        run: (editor, range) => {
          const href = r.type === 'card' ? cardHref(r.id) : docHref(r.id)
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([
              { type: 'text', text: r.title || t('untitled', { ns: 'common' }), marks: [{ type: 'link', attrs: { href } }] },
              { type: 'text', text: ' ' },
            ])
            .run()
        },
      }))
    } catch {
      return []
    }
  }

  const editor = useEditor({
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    // Done in onCreate, at the end of the text rather than in that empty paragraph.
    autofocus: false,
    extensions: [
      ...documentExtensions(),
      // On the empty line with the cursor: a heading's name; the page's or field's own hint when it
      // is all empty; elsewhere how to insert a block, shown only while the editor has the focus
      // (editor.css). It follows the cursor, not the focus: a decoration that changed with the focus
      // would redraw the page as a click focuses it, before the click's cursor is read.
      Placeholder.configure({
        placeholder: ({ editor, node, pos }) =>
          node.type.name === 'heading'
            ? tRef.current('editor.headingPlaceholder')
            : pos === 0 && editor.isEmpty
              ? (placeholderRef.current ?? tRef.current('editor.placeholder'))
              : node.type.name === 'paragraph'
                ? tRef.current('editor.lineHint')
                : '',
        emptyNodeClass: ({ editor, node, pos }) => (node.type.name === 'paragraph' && !(pos === 0 && editor.isEmpty) ? 'is-empty orq-line-hint' : 'is-empty'),
        showOnlyCurrent: true,
      }),
      SlashCommands.configure({ store: slashStore, items: slashItems }),
      Mentions.configure({ store: mentionStore, items: mentionItems }),
      MathKeys,
      ...(blockHandles ? [BlockKeys] : []),
    ],
    content,
    contentType: 'markdown',
    editorProps: {
      attributes: {
        class: cn('orq-prose', compact && 'orq-prose--compact'),
        'aria-label': ariaLabel ?? t('editor.label'),
        ...(ariaDescribedBy ? { 'aria-describedby': ariaDescribedBy } : {}),
        role: 'textbox',
        'aria-multiline': 'true',
        spellcheck: 'true',
      },
      handlePaste: (view, event) => {
        const files = [...(event.clipboardData?.files ?? [])]
        if (!files.length || !uploadRef.current || !editorRef.current) return false
        event.preventDefault()
        void handleFiles(editorRef.current, files)
        return true
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = [...(event.dataTransfer?.files ?? [])]
        if (moved || !files.length || !uploadRef.current || !editorRef.current) return false
        event.preventDefault()
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        void handleFiles(editorRef.current, files, pos)
        return true
      },
      handleClick: (_view, _pos, event) => {
        const anchor = (event.target as HTMLElement).closest('a')
        const href = anchor?.getAttribute('href')
        if (!href) return false
        if (/^\/(card|doc)\//.test(href)) {
          event.preventDefault()
          navigate(href)
          return true
        }
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault()
          window.open(href, '_blank', 'noopener,noreferrer')
          return true
        }
        return false
      },
    },
    onMount: ({ editor }) => {
      // The empty paragraph kept after anything but a paragraph at the end (TrailingNode) comes
      // with the first transaction. It comes now, out of the undo history and with no update, so
      // that the first is not the one a focus makes. In Firefox a click focuses before the selection
      // it placed is read, and redrawing the document put the cursor back where it was, at the
      // start. In Safari autofocus focuses while its own transaction is being made, which that
      // change then left behind ("Applying a mismatched transaction").
      editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false).setMeta('preventUpdate', true))
    },
    onCreate: ({ editor }) => {
      emitted.current = editor.getMarkdown()
      if (autofocus) {
        editor.view.dispatch(editor.state.tr.setSelection(textEnd(editor.state.doc)).setMeta('addToHistory', false))
        editor.commands.focus()
      }
    },
    // Content set from outside (another tab, an agent) is the new starting point.
    onTransaction: ({ editor, transaction }) => {
      if (transaction.docChanged && transaction.getMeta('preventUpdate')) emitted.current = editor.getMarkdown()
    },
    onUpdate: ({ editor }) => {
      const markdown = editor.getMarkdown()
      // The empty line the editor keeps after a list or a table at the end is not a change.
      if (markdown.trimEnd() === emitted.current.trimEnd()) return
      emitted.current = markdown
      onChangeRef.current(markdown)
    },
  })

  const editorRef = useRef<TiptapEditor | null>(null)
  editorRef.current = editor

  useEffect(() => {
    if (editor) onReady?.(editor)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  return (
    <div className={cn('relative', className)}>
      <EditorContent editor={editor} />
      {editor && <FormatMenu editor={editor} />}
      {editor && <TableControls editor={editor} />}
      {editor && <CodeControls editor={editor} />}
      {editor && <CalloutControls editor={editor} />}
      {editor && <ImageControls editor={editor} />}
      {editor && <MathControls editor={editor} />}
      {editor && blockHandles && <BlockControls editor={editor} />}
      <SuggestionMenu store={slashStore} emptyLabel={t('editor.noBlocks')} />
      <SuggestionMenu store={mentionStore} emptyLabel={t('editor.mentionHint')} />
      <input
        ref={fileInput}
        type="file"
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (editor && files.length) void handleFiles(editor, files)
        }}
        accept={undefined}
        onClick={(e) => {
          ;(e.target as HTMLInputElement).accept = pendingUploadKind.current === 'image' ? 'image/png,image/jpeg,image/gif,image/webp,image/avif' : ''
        }}
      />
    </div>
  )
}
