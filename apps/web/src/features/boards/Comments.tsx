import { type CardDetailDTO, type CommentDTO, MAX_COMMENT, type TrashedDTO, characters } from '@orqevio/shared'
import { Ellipsis, Pencil, Trash } from 'lucide-react'
import { type KeyboardEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from '../../components/ui/Menu'
import { del, errorMessage, patch, post } from '../../lib/api'
import { dateTime, relativeTime } from '../../lib/format'
import { keys, queryClient, useComments } from '../../lib/queries'
import { toastTrashed } from '../../lib/trash'
import { Editor } from '../docs/editor/Editor'
import { useWorkspace } from '../shell/workspace'

/** The card, its comments and its board (which counts them), as they are now. */
const refresh = (card: CardDetailDTO) =>
  Promise.all([queryClient.invalidateQueries({ queryKey: keys.card(card.id) }), queryClient.invalidateQueries({ queryKey: keys.board(card.boardId) })])

/** Ctrl+Enter (⌘+Enter) sends, before the editor takes it for a line break. */
const sendOn = (send: () => void) => (event: KeyboardEvent) => {
  if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return
  event.preventDefault()
  event.stopPropagation()
  send()
}

/** The comments of a card, the newest first, with a box to write one above them. */
export function Comments({ card }: { card: CardDetailDTO }) {
  const { t } = useTranslation('boards')
  const comments = useComments(card.id)
  const list = comments.data?.pages.flatMap((page) => page.comments) ?? []
  return (
    <div className="flex flex-col gap-4">
      <Composer card={card} />
      {comments.isError ? (
        <p className="text-[13px] text-danger">{errorMessage(comments.error)}</p>
      ) : list.length > 0 ? (
        <ol className="flex flex-col gap-4" aria-label={t('sheet.comments.list')}>
          {list.map((comment) => (
            <CommentItem key={comment.id} comment={comment} card={card} />
          ))}
        </ol>
      ) : (
        !comments.isPending && <p className="text-[13px] text-ink-3">{t('sheet.comments.empty')}</p>
      )}
      {comments.hasNextPage && (
        <Button size="sm" variant="ghost" className="self-start" loading={comments.isFetchingNextPage} onClick={() => void comments.fetchNextPage()}>
          {t('sheet.comments.older')}
        </Button>
      )}
    </div>
  )
}

/** Whether a text can be sent: something that shows, within the limit. */
function useDraft(initial: string) {
  const [text, setText] = useState(initial)
  const length = characters(text.trim())
  return { text, setText, empty: text.trim().length === 0, tooLong: length > MAX_COMMENT, length }
}

function Composer({ card }: { card: CardDetailDTO }) {
  const { t } = useTranslation('boards')
  const { workspaceId } = useWorkspace()
  const draft = useDraft('')
  const [sending, setSending] = useState(false)
  // A new editor each time one is sent: it starts empty again.
  const [round, setRound] = useState(0)

  async function send() {
    if (draft.empty || draft.tooLong || sending) return
    setSending(true)
    try {
      await post(`/cards/${card.id}/comments`, { body: draft.text })
      draft.setText('')
      setRound((r) => r + 1)
      await refresh(card)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSending(false)
    }
  }

  return (
    <div onKeyDownCapture={sendOn(() => void send())}>
      <Editor
        key={round}
        content=""
        workspaceId={workspaceId}
        compact
        upload={{ type: 'card', id: card.id }}
        onUploaded={() => void refresh(card)}
        placeholder={t('sheet.comments.placeholder')}
        ariaLabel={t('sheet.comments.label')}
        onChange={draft.setText}
        className="orq-comment-input rounded-[10px] border border-line bg-surface px-3 py-2 focus-within:border-ink-4"
      />
      <Limit draft={draft} />
      <div className="mt-2 flex items-center justify-end gap-3">
        <span className="text-[11.5px] text-ink-3 max-[900px]:hidden">{t('sheet.comments.hint')}</span>
        <Button size="sm" variant="primary" disabled={draft.empty || draft.tooLong} loading={sending} onClick={() => void send()}>
          {t('sheet.comments.submit')}
        </Button>
      </div>
    </div>
  )
}

function Limit({ draft }: { draft: ReturnType<typeof useDraft> }) {
  const { t } = useTranslation('boards')
  if (!draft.tooLong) return null
  return (
    <p role="alert" className="mt-1.5 text-[12px] text-danger">
      {t('sheet.comments.tooLong', { max: MAX_COMMENT.toLocaleString(), count: draft.length - MAX_COMMENT })}
    </p>
  )
}

function CommentItem({ comment, card }: { comment: CommentDTO; card: CardDetailDTO }) {
  const { t } = useTranslation(['boards', 'activity'])
  const { workspaceId } = useWorkspace()
  const [editing, setEditing] = useState(false)
  const agent = comment.author.kind === 'agent'
  const when = relativeTime(comment.createdAt)

  async function remove() {
    try {
      toastTrashed(t('sheet.comments.deleted'), await del<TrashedDTO>(`/comments/${comment.id}`))
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      await refresh(card)
    }
  }

  return (
    <li className="flex gap-3" aria-label={t('sheet.comments.by', { name: comment.author.name, when })}>
      <Avatar name={comment.author.name} kind={comment.author.kind} size={26} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex min-h-6 flex-wrap items-center gap-x-2 text-[12.5px] leading-tight">
          <span className={agent ? 'font-medium text-agent' : 'font-medium text-ink'}>{comment.author.name}</span>
          {agent && <span className="text-ink-3">{t('activity:viaMcp')}</span>}
          <time dateTime={comment.createdAt} title={dateTime(comment.createdAt)} className="text-ink-3">
            {when}
          </time>
          {comment.editedAt && (
            <span className="text-ink-3" title={dateTime(comment.editedAt)}>
              {t('sheet.comments.edited')}
            </span>
          )}
          {(comment.canEdit || comment.canDelete) && !editing && (
            <MenuRoot>
              <MenuTrigger asChild>
                <button type="button" aria-label={t('sheet.comments.actions')} className="ml-auto grid size-6 place-items-center rounded-[6px] text-ink-3 hover:bg-hover hover:text-ink">
                  <Ellipsis className="size-4" />
                </button>
              </MenuTrigger>
              <MenuContent>
                {comment.canEdit && (
                  <MenuItem icon={<Pencil />} onSelect={() => setEditing(true)}>
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
        {editing ? (
          <EditComment comment={comment} card={card} onDone={() => setEditing(false)} />
        ) : (
          // Shown anew when its text changes: the editor keeps what it was created with.
          <Editor
            key={`${comment.id}:${comment.updatedAt}`}
            readOnly
            content={comment.body}
            workspaceId={workspaceId}
            compact
            onChange={() => {}}
            className="orq-comment mt-1 rounded-[10px] bg-surface px-3 py-2 break-words"
          />
        )}
      </div>
    </li>
  )
}

function EditComment({ comment, card, onDone }: { comment: CommentDTO; card: CardDetailDTO; onDone: () => void }) {
  const { t } = useTranslation('boards')
  const { workspaceId } = useWorkspace()
  const draft = useDraft(comment.body)
  const [saving, setSaving] = useState(false)

  async function save() {
    if (draft.empty || draft.tooLong || saving) return
    setSaving(true)
    try {
      await patch(`/comments/${comment.id}`, { body: draft.text })
      await refresh(card)
      onDone()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-1" onKeyDownCapture={sendOn(() => void save())}>
      <Editor
        content={comment.body}
        workspaceId={workspaceId}
        compact
        autofocus
        upload={{ type: 'card', id: card.id }}
        onUploaded={() => void refresh(card)}
        ariaLabel={t('sheet.comments.editLabel')}
        onChange={draft.setText}
        className="orq-comment-input rounded-[10px] border border-line bg-surface px-3 py-2 focus-within:border-ink-4"
      />
      <Limit draft={draft} />
      <div className="mt-2 flex items-center justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>
          {t('sheet.comments.cancel')}
        </Button>
        <Button size="sm" variant="primary" disabled={draft.empty || draft.tooLong} loading={saving} onClick={() => void save()}>
          {t('sheet.comments.save')}
        </Button>
      </div>
    </div>
  )
}
