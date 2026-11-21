import { type CardDetailDTO, type CommentDTO, MAX_COMMENT, type TrashedDTO, characters } from '@orqevio/shared'
import type { Editor as TiptapEditor } from '@tiptap/core'
import { Ellipsis, Pencil, Trash } from 'lucide-react'
import { type KeyboardEvent, type MouseEvent, memo, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { modKey } from '../../components/ui/Kbd'
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from '../../components/ui/Menu'
import { del, errorMessage, patch, post } from '../../lib/api'
import { dateTime, formatNumber, relativeTime } from '../../lib/format'
import { keys, queryClient, useComments } from '../../lib/queries'
import { restoreFromTrash } from '../../lib/trash'
import { Editor } from '../docs/editor/Editor'
import { markdownToHtml } from '../docs/editor/markdown-html'
import { useWorkspace } from '../shell/workspace'

/**
 * Text written and not sent yet, by person and card (a new comment) or comment (one being edited,
 * with the version it was edited from). It outlives the sheet: closing the card, or following a
 * link in it, loses none of it; another account signing in on this tab never sees it.
 */
const drafts = new Map<string, { text: string; base?: string }>()
const newDraft = (userId: string, cardId: string) => `${userId}:new:${cardId}`
const editDraft = (userId: string, commentId: string) => `${userId}:edit:${commentId}`
const keep = (key: string, text: string, base?: string) => (text.trim() ? drafts.set(key, { text, base }) : drafts.delete(key))
/** An edit still to finish, if the comment is still as it was when it began and its author's to change. */
function pendingEdit(key: string, comment: CommentDTO) {
  const draft = drafts.get(key)
  if (draft && draft.base === comment.updatedAt && comment.canEdit) return draft.text
  drafts.delete(key)
  return undefined
}

/** The card's comments, its count and its board's, as they are now. */
const refresh = (cardId: string, boardId: string) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: keys.comments(cardId) }),
    queryClient.invalidateQueries({ queryKey: keys.card(cardId) }),
    queryClient.invalidateQueries({ queryKey: keys.board(boardId) }),
  ])

/** Ctrl+Enter (⌘+Enter) sends, before the editor takes it for a line break. */
const sendOn = (send: () => void) => (event: KeyboardEvent) => {
  if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return
  event.preventDefault()
  event.stopPropagation()
  send()
}

/** Whether a text can be sent: something that shows, within the limit. */
function measure(text: string) {
  const length = characters(text.trim())
  return { empty: text.trim().length === 0, tooLong: length > MAX_COMMENT, over: length - MAX_COMMENT }
}

/** The comments of a card, the newest first, with a box to write one above them. */
export function Comments({ card }: { card: CardDetailDTO }) {
  const { t } = useTranslation(['boards', 'trash'])
  const comments = useComments(card.id)
  const list = useRef<HTMLOListElement>(null)
  // The last one deleted here, to bring it back without leaving the sheet (the notices are out of reach of the keyboard).
  const [removed, setRemoved] = useState<string | null>(null)
  // Back from the trash, the focus goes to the list once it shows again.
  const [focusList, setFocusList] = useState(false)
  const shown = useMemo(() => {
    const seen = new Set<string>()
    return (comments.data?.pages.flatMap((page) => page.comments) ?? []).filter((c) => !seen.has(c.id) && Boolean(seen.add(c.id)))
  }, [comments.data])
  useEffect(() => {
    if (!focusList || !list.current) return
    list.current.focus()
    setFocusList(false)
  }, [focusList, shown])

  // During a refetch (a comment arrived), the earlier page waits for it and is then asked for again.
  async function older() {
    const pages = comments.data?.pages.length ?? 0
    const result = await comments.fetchNextPage({ cancelRefetch: false })
    if ((result.data?.pages.length ?? 0) <= pages && result.hasNextPage) await comments.fetchNextPage({ cancelRefetch: false })
  }

  return (
    <div className="flex flex-col gap-4">
      <Composer card={card} onSent={() => setRemoved(null)} />
      {removed && <Removed trashId={removed} card={card} onDone={() => (setRemoved(null), setFocusList(true))} />}
      {shown.length > 0 ? (
        <ol ref={list} tabIndex={-1} className="flex flex-col gap-4 outline-none" aria-label={t('sheet.comments.list')}>
          {shown.map((comment) => (
            <CommentItem key={comment.id} comment={comment} cardId={card.id} boardId={card.boardId} onRemoved={setRemoved} />
          ))}
        </ol>
      ) : comments.isError ? (
        <p className="text-[13px] text-danger">{errorMessage(comments.error)}</p>
      ) : (
        !comments.isPending && <p className="text-[13px] text-ink-3">{t('sheet.comments.empty')}</p>
      )}
      {comments.isFetchNextPageError && <p className="text-[13px] text-danger">{errorMessage(comments.error)}</p>}
      {comments.hasNextPage && (
        <Button size="sm" variant="ghost" className="self-start" loading={comments.isFetchingNextPage} onClick={() => void older()}>
          {t('sheet.comments.older')}
        </Button>
      )}
    </div>
  )
}

/** Where a deleted comment was told of, with a way to bring it back. */
function Removed({ trashId, card, onDone }: { trashId: string; card: CardDetailDTO; onDone: () => void }) {
  const { t } = useTranslation(['boards', 'trash'])
  const undo = useRef<HTMLButtonElement>(null)
  const said = useId()
  useEffect(() => undo.current?.focus(), [trashId])
  return (
    <p role="status" className="flex items-center gap-3 rounded-[10px] bg-sunken px-3 py-2 text-[13px] text-ink-2">
      <span id={said}>{t('sheet.comments.deleted')}</span>
      <button
        ref={undo}
        type="button"
        // Said with it when it takes the focus: the message above it may not be read when it appears.
        aria-describedby={said}
        className="ml-auto rounded-[8px] bg-ink px-2.5 py-1 text-[12px] font-medium text-sheet"
        onClick={async () => {
          try {
            await restoreFromTrash(trashId)
            await refresh(card.id, card.boardId)
          } catch (error) {
            toast.error(errorMessage(error))
          }
          onDone()
        }}
      >
        {t('trash:toast.undo')}
      </button>
    </p>
  )
}

function Composer({ card, onSent }: { card: CardDetailDTO; onSent: () => void }) {
  const { t } = useTranslation('boards')
  const { workspaceId, me } = useWorkspace()
  const draftKey = newDraft(me.user.id, card.id)
  const [text, setText] = useState(() => drafts.get(draftKey)?.text ?? '')
  const [sending, setSending] = useState(false)
  const editor = useRef<TiptapEditor | null>(null)
  const hint = useId()
  const { empty, tooLong, over } = measure(text)

  async function send() {
    if (empty || tooLong || sending) return
    const body = text
    setSending(true)
    // Nothing typed while it goes is lost: the box waits.
    editor.current?.setEditable(false)
    try {
      await post(`/cards/${card.id}/comments`, { body })
      drafts.delete(draftKey)
      editor.current?.setEditable(true)
      // The same box, empty and with the focus, for the next one.
      editor.current?.chain().clearContent(true).focus().run()
      onSent()
      await refresh(card.id, card.boardId)
    } catch (error) {
      toast.error(errorMessage(error))
      // Back in the box, as it was, to try again.
      editor.current?.setEditable(true)
      editor.current?.commands.focus()
    } finally {
      setSending(false)
    }
  }

  return (
    <div onKeyDownCapture={sendOn(() => void send())}>
      <Editor
        content={drafts.get(draftKey)?.text ?? ''}
        workspaceId={workspaceId}
        compact
        upload={{ type: 'card', id: card.id }}
        onUploaded={() => void refresh(card.id, card.boardId)}
        onReady={(instance) => (editor.current = instance)}
        placeholder={t('sheet.comments.placeholder')}
        ariaLabel={t('sheet.comments.label')}
        ariaDescribedBy={hint}
        onChange={(markdown) => {
          setText(markdown)
          keep(draftKey, markdown)
        }}
        className="orq-comment-input rounded-[10px] border border-line bg-surface px-3 py-2 focus-within:border-ink-4"
      />
      <Limit tooLong={tooLong} over={over} />
      <div className="mt-2 flex items-center justify-end gap-3">
        {/* Said to screen readers on every width; shown where there is a keyboard to use it. */}
        <span id={hint} className="text-[11.5px] text-ink-3 max-[900px]:sr-only">
          <Trans t={t} i18nKey="sheet.comments.hint" values={{ mod: modKey }} components={{ kbd: <kbd className="kbd" /> }} />
        </span>
        <Button size="sm" variant="primary" disabled={empty || tooLong} loading={sending} onClick={() => void send()}>
          {t('sheet.comments.submit')}
        </Button>
      </div>
    </div>
  )
}

function Limit({ tooLong, over }: { tooLong: boolean; over: number }) {
  const { t } = useTranslation('boards')
  return (
    <p role="status" className="mt-1.5 text-[12px] text-danger empty:hidden">
      {tooLong ? t('sheet.comments.tooLong', { max: formatNumber(MAX_COMMENT), count: over }) : ''}
    </p>
  )
}

/** A comment as Markdown, shown, not edited: links are followed, inside the app or in a new tab. */
function Body({ markdown }: { markdown: string }) {
  const navigate = useNavigate()
  const html = useMemo(() => markdownToHtml(markdown), [markdown])
  const follow = (event: MouseEvent) => {
    const link = (event.target as HTMLElement).closest('a')
    if (!link) return
    // A link without an address the editor allows has none: it leads nowhere, rather than reloading the app.
    event.preventDefault()
    const href = link.getAttribute('href')
    if (!href) return
    if (/^\/(card|doc)\//.test(href)) navigate(href)
    else window.open(href, '_blank', 'noopener,noreferrer')
  }
  return (
    <div
      className="orq-prose orq-prose--compact orq-prose--note mt-1 overflow-x-auto rounded-[10px] bg-surface px-3 py-2 break-words"
      onClick={follow}
      // What the editor itself would show, from its schema: escaped text and allowed addresses only.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

const CommentItem = memo(function CommentItem({ comment, cardId, boardId, onRemoved }: { comment: CommentDTO; cardId: string; boardId: string; onRemoved: (trashId: string) => void }) {
  const { t } = useTranslation(['boards', 'activity'])
  const { me } = useWorkspace()
  const draftKey = editDraft(me.user.id, comment.id)
  // Still being edited when the card was closed, and the comment unchanged since: it opens as it was left.
  const [editing, setEditing] = useState(() => pendingEdit(draftKey, comment) !== undefined)
  // Begun now from its menu: the box takes the focus (one left from before doesn't, as the sheet opens).
  const [begun, setBegun] = useState(false)
  const actions = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(false)
  const agent = comment.author.kind === 'agent'

  // Done editing: the focus goes back to the comment's menu, rather than to the top of the sheet.
  useEffect(() => {
    if (editing || !returnFocus.current) return
    returnFocus.current = false
    actions.current?.focus()
  }, [editing])

  const stopEditing = () => {
    returnFocus.current = true
    setBegun(false)
    setEditing(false)
  }

  async function remove() {
    try {
      const result = await del<TrashedDTO>(`/comments/${comment.id}`)
      if (result.trashId) onRemoved(result.trashId)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      await refresh(cardId, boardId)
    }
  }

  return (
    <li className="flex gap-3">
      <Avatar name={comment.author.name} kind={comment.author.kind} size={26} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex min-h-6 flex-wrap items-center gap-x-2 text-[12.5px] leading-tight">
          <span className={agent ? 'font-medium text-agent' : 'font-medium text-ink'}>{comment.author.name}</span>
          {agent && <span className="text-ink-3">{t('activity:viaMcp')}</span>}
          <time dateTime={comment.createdAt} title={dateTime(comment.createdAt)} className="text-ink-3">
            {relativeTime(comment.createdAt)}
          </time>
          {comment.editedAt && (
            <span className="text-ink-3" title={dateTime(comment.editedAt)}>
              {t('sheet.comments.edited')}
            </span>
          )}
          {(comment.canEdit || comment.canDelete) && !editing && (
            <MenuRoot>
              <MenuTrigger asChild>
                <button
                  ref={actions}
                  type="button"
                  aria-label={t('sheet.comments.actions', { name: comment.author.name })}
                  className="ml-auto grid size-6 place-items-center rounded-[6px] text-ink-3 hover:bg-hover hover:text-ink"
                >
                  <Ellipsis className="size-4" />
                </button>
              </MenuTrigger>
              <MenuContent>
                {comment.canEdit && (
                  <MenuItem
                    icon={<Pencil />}
                    onSelect={() => {
                      setBegun(true)
                      setEditing(true)
                    }}
                  >
                    {t('sheet.comments.edit')}
                  </MenuItem>
                )}
                {comment.canDelete && (
                  <MenuItem icon={<Trash />} danger onSelect={() => void remove()}>
                    {t('sheet.comments.delete')}
                  </MenuItem>
                )}
              </MenuContent>
            </MenuRoot>
          )}
        </div>
        {editing ? <EditComment comment={comment} draftKey={draftKey} focus={begun} cardId={cardId} boardId={boardId} onDone={stopEditing} /> : <Body markdown={comment.body} />}
      </div>
    </li>
  )
})

function EditComment({ comment, draftKey, focus, cardId, boardId, onDone }: { comment: CommentDTO; draftKey: string; focus: boolean; cardId: string; boardId: string; onDone: () => void }) {
  const { t } = useTranslation('boards')
  const { workspaceId } = useWorkspace()
  const [initial] = useState(() => pendingEdit(draftKey, comment) ?? comment.body)
  // The version the edit began from: changed since, the edit left on closing the card is dropped.
  const [base] = useState(comment.updatedAt)
  const [text, setText] = useState(initial)
  const [saving, setSaving] = useState(false)
  const editor = useRef<TiptapEditor | null>(null)
  const { empty, tooLong, over } = measure(text)

  async function save() {
    if (empty || tooLong || saving) return
    setSaving(true)
    editor.current?.setEditable(false)
    try {
      await patch(`/comments/${comment.id}`, { body: text })
      drafts.delete(draftKey)
      await refresh(cardId, boardId)
      onDone()
    } catch (error) {
      toast.error(errorMessage(error))
      editor.current?.setEditable(true)
      editor.current?.commands.focus()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-1" onKeyDownCapture={sendOn(() => void save())}>
      <Editor
        content={initial}
        workspaceId={workspaceId}
        compact
        autofocus={focus}
        upload={{ type: 'card', id: cardId }}
        onUploaded={() => void refresh(cardId, boardId)}
        onReady={(instance) => (editor.current = instance)}
        ariaLabel={t('sheet.comments.editLabel')}
        onChange={(markdown) => {
          setText(markdown)
          keep(draftKey, markdown, base)
        }}
        className="orq-comment-input rounded-[10px] border border-line bg-surface px-3 py-2 focus-within:border-ink-4"
      />
      <Limit tooLong={tooLong} over={over} />
      <div className="mt-2 flex items-center justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            drafts.delete(draftKey)
            onDone()
          }}
        >
          {t('sheet.comments.cancel')}
        </Button>
        <Button size="sm" variant="primary" disabled={empty || tooLong} loading={saving} onClick={() => void save()}>
          {t('sheet.comments.save')}
        </Button>
      </div>
    </div>
  )
}
