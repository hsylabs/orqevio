import type { AttachmentDTO, MeDTO, SearchResultDTO } from '@orqevio/shared'
import { cardHref, docHref } from '@orqevio/shared'
import type { Editor as TiptapEditor } from '@tiptap/core'
import { TableKit } from '@tiptap/extension-table'
import Image from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { ApiError, api, errorMessage, get } from '../../../lib/api'
import { cn } from '../../../lib/cn'
import { keys, queryClient } from '../../../lib/queries'
import { FormatMenu } from './FormatMenu'
import { Mentions, SlashCommands } from './extensions'
import { SuggestionMenu } from './SuggestionMenu'
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
}

const SAFE_PROTOCOL = /^(https?:|mailto:|\/(?!\/))/i

export async function uploadFile(file: File, target: UploadTarget): Promise<AttachmentDTO> {
  // The server refuses oversized files before reading them, which browsers report as a
  // network error; checking first gives the real reason.
  const limit = queryClient.getQueryData<MeDTO>(keys.me)?.limits.maxUploadBytes
  if (limit !== undefined && file.size > limit) throw new ApiError(413, 'file_too_large', 'File too large')
  return api<AttachmentDTO>('POST', `/${target.type === 'page' ? 'pages' : 'cards'}/${target.id}/attachments`, file)
}

function insertAttachment(editor: TiptapEditor, attachment: AttachmentDTO, pos?: number) {
  const content = attachment.isImage
    ? { type: 'image', attrs: { src: attachment.url, alt: attachment.filename } }
    : { type: 'paragraph', content: [{ type: 'text', text: attachment.filename, marks: [{ type: 'link', attrs: { href: attachment.url } }] }] }
  const chain = editor.chain().focus()
  if (pos !== undefined) chain.insertContentAt(pos, content).run()
  else chain.insertContent(content).run()
}

export function Editor({ content, onChange, placeholder, workspaceId, upload, compact, autofocus, onReady, onUploaded, className, ariaLabel }: EditorProps) {
  const navigate = useNavigate()
  const slashStore = useMemo(createSuggestionStore, [])
  const mentionStore = useMemo(createSuggestionStore, [])
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const uploadRef = useRef(upload)
  uploadRef.current = upload
  const onUploadedRef = useRef(onUploaded)
  onUploadedRef.current = onUploaded
  const fileInput = useRef<HTMLInputElement>(null)
  const pendingUploadKind = useRef<'image' | 'file'>('image')

  async function handleFiles(editor: TiptapEditor, files: File[], pos?: number) {
    const target = uploadRef.current
    if (!target) return false
    for (const file of files) {
      const id = toast.loading(`Subiendo ${file.name}…`)
      try {
        const attachment = await uploadFile(file, target)
        insertAttachment(editor, attachment, pos)
        onUploadedRef.current?.(attachment)
        toast.success('Archivo adjuntado', { id })
      } catch (error) {
        toast.error(errorMessage(error), { id })
      }
    }
    return true
  }

  const slashItems = (query: string): MenuItem[] => {
    const items: Array<MenuItem & { keywords: string }> = [
      { id: 'p', title: 'Texto', subtitle: 'Párrafo normal', icon: 'T', group: 'Bloques', keywords: 'texto parrafo paragraph', run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
      { id: 'h1', title: 'Título 1', subtitle: 'Encabezado grande', icon: 'H1', group: 'Bloques', keywords: 'titulo heading h1', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run() },
      { id: 'h2', title: 'Título 2', subtitle: 'Encabezado de sección', icon: 'H2', group: 'Bloques', keywords: 'titulo heading h2', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run() },
      { id: 'h3', title: 'Título 3', subtitle: 'Subsección', icon: 'H3', group: 'Bloques', keywords: 'titulo heading h3', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run() },
      { id: 'ul', title: 'Lista', subtitle: 'Lista con viñetas', icon: '•', group: 'Listas', keywords: 'lista bullet viñetas ul', run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
      { id: 'ol', title: 'Lista numerada', subtitle: '1, 2, 3…', icon: '1.', group: 'Listas', keywords: 'lista numerada ordered ol', run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
      { id: 'todo', title: 'Lista de tareas', subtitle: 'Casillas para marcar', icon: '☑', group: 'Listas', keywords: 'tareas checklist todo check', run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
      { id: 'quote', title: 'Cita', subtitle: 'Destaca un fragmento', icon: '❝', group: 'Bloques', keywords: 'cita quote blockquote', run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
      { id: 'code', title: 'Código', subtitle: 'Bloque de código', icon: '</>', group: 'Bloques', keywords: 'codigo code', run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
      { id: 'table', title: 'Tabla', subtitle: '3 × 3 con cabecera', icon: '▦', group: 'Insertar', keywords: 'tabla table', run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
      { id: 'hr', title: 'Separador', subtitle: 'Línea horizontal', icon: '—', group: 'Insertar', keywords: 'separador divider hr linea', run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
      { id: 'mention', title: 'Enlazar tarea o página', subtitle: 'Escribe @ y busca', icon: '@', group: 'Insertar', keywords: 'mencion enlace tarea pagina link mention', run: (e, r) => e.chain().focus().deleteRange(r).insertContent('@').run() },
    ]
    if (uploadRef.current) {
      items.push(
        { id: 'image', title: 'Imagen', subtitle: 'Sube PNG, JPG, GIF o WebP', icon: '▣', group: 'Insertar', keywords: 'imagen image foto', run: (e, r) => { e.chain().focus().deleteRange(r).run(); pendingUploadKind.current = 'image'; fileInput.current?.click() } },
        { id: 'file', title: 'Archivo', subtitle: 'Adjunta cualquier archivo', icon: '⎘', group: 'Insertar', keywords: 'archivo adjunto file attachment', run: (e, r) => { e.chain().focus().deleteRange(r).run(); pendingUploadKind.current = 'file'; fileInput.current?.click() } },
      )
    }
    const q = query.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
    return items.filter((i) => !q || `${i.title} ${i.keywords}`.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').includes(q))
  }

  const mentionItems = async (query: string): Promise<MenuItem[]> => {
    if (query.trim().length === 0) return []
    try {
      const results = await get<SearchResultDTO[]>(`/workspaces/${workspaceId}/search?q=${encodeURIComponent(query.trim())}`)
      return results.slice(0, 8).map((r) => ({
        id: `${r.type}-${r.id}`,
        title: r.title || 'Sin título',
        subtitle: r.type === 'card' ? `Tarea · ${r.boardName} · ${r.columnName}` : `Página · ${r.projectName}`,
        icon: r.type === 'card' ? '▤' : (r.icon ?? '¶'),
        group: r.type === 'card' ? 'Tareas' : 'Páginas',
        run: (editor, range) => {
          const href = r.type === 'card' ? cardHref(r.id) : docHref(r.id)
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([
              { type: 'text', text: r.title || 'Sin título', marks: [{ type: 'link', attrs: { href } }] },
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
    autofocus: autofocus ? 'end' : false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        underline: false,
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          defaultProtocol: 'https',
          isAllowedUri: (url, ctx) => SAFE_PROTOCOL.test(url) && ctx.defaultValidate(url),
          HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: null },
        },
      }),
      Markdown.configure({ markedOptions: { gfm: true } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: false } }),
      Image.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({
        placeholder: ({ node, pos }) => (node.type.name === 'heading' ? 'Encabezado' : pos === 0 ? (placeholder ?? 'Escribe, o pulsa «/» para insertar…') : ''),
        showOnlyCurrent: true,
      }),
      SlashCommands.configure({ store: slashStore, items: slashItems }),
      Mentions.configure({ store: mentionStore, items: mentionItems }),
    ],
    content,
    contentType: 'markdown',
    editorProps: {
      attributes: {
        class: cn('orq-prose', compact && 'orq-prose--compact'),
        'aria-label': ariaLabel ?? 'Contenido',
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
    onUpdate: ({ editor }) => onChangeRef.current(editor.getMarkdown()),
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
      <SuggestionMenu store={slashStore} emptyLabel="Ningún bloque coincide" />
      <SuggestionMenu store={mentionStore} emptyLabel="Escribe para buscar tareas y páginas" />
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
          ;(e.target as HTMLInputElement).accept = pendingUploadKind.current === 'image' ? 'image/png,image/jpeg,image/gif,image/webp' : ''
        }}
      />
    </div>
  )
}
