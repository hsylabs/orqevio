import type { PageDTO } from '@orqevio/shared'
import { extractReferences } from '@orqevio/shared'
import type { Editor as TiptapEditor } from '@tiptap/core'
import { Bot, CornerDownRight, Ellipsis, FileText, FilePlus, FolderInput, Paperclip, SquareKanban, Trash, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from '../../components/ui/Menu'
import { ApiError, errorMessage, get, patch } from '../../lib/api'
import { cn } from '../../lib/cn'
import { relativeTime } from '../../lib/format'
import { keys, queryClient, usePage } from '../../lib/queries'
import { onPageEvent, useAgentHighlight } from '../../lib/realtime'
import { Attachments } from '../boards/Attachments'
import { DueChip } from '../boards/CardItem'
import { PageHeader } from '../shell/PageHeader'
import { useStructureActions } from '../shell/actions'
import { NotFound, PageSkeleton } from '../shell/States'
import { useWorkspace } from '../shell/workspace'
import { Editor } from './editor/Editor'
import { IconPicker } from './IconPicker'
import { MovePageDialog } from './MovePageDialog'

type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

export function DocPage() {
  const { pageId = '' } = useParams()
  const page = usePage(pageId)
  if (page.isError) return page.error instanceof ApiError && page.error.status === 404 ? <NotFound /> : <NotFound />
  if (!page.data) return <PageSkeleton />
  return <DocBody key={page.data.id} page={page.data} />
}

function DocBody({ page }: { page: PageDTO }) {
  const { t } = useTranslation('docs')
  const { workspaceId, me, overview } = useWorkspace()
  const navigate = useNavigate()
  const location = useLocation()
  const actions = useStructureActions(workspaceId)
  const agent = useAgentHighlight(page.id)

  const [title, setTitle] = useState(page.title)
  const [icon, setIcon] = useState(page.icon)
  const [status, setStatus] = useState<SaveStatus>('idle')
  /** Who changed the page under the editor; `by: null` is another session of this user. */
  const [conflict, setConflict] = useState<{ by: string | null } | null>(null)
  const [moveOpen, setMoveOpen] = useState(false)

  const editorRef = useRef<TiptapEditor | null>(null)
  const version = useRef(page.version)
  const latest = useRef(page.content)
  const dirty = useRef(false)
  const saving = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const titleTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const titleFocused = useRef(false)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const conflictRef = useRef(false)
  conflictRef.current = conflict !== null
  const mentions = useRef(extractReferences(page.content).cards.sort().join(','))

  // Autosize the title.
  useEffect(() => {
    const el = titleRef.current
    if (el) {
      el.style.height = '0'
      el.style.height = `${el.scrollHeight}px`
    }
  }, [title])

  useEffect(() => {
    if ((location.state as { focusTitle?: boolean } | null)?.focusTitle) titleRef.current?.focus()
  }, [location.state])

  // Keep metadata (title, icon) in sync with server data when not editing them.
  useEffect(() => {
    if (!titleFocused.current) setTitle(page.title)
    setIcon(page.icon)
  }, [page.title, page.icon])

  const save = useCallback(async () => {
    if (saving.current || conflictRef.current || !dirty.current) return
    saving.current = true
    setStatus('saving')
    const content = latest.current
    try {
      const res = await patch<{ version: number }>(`/pages/${page.id}`, { content, baseVersion: version.current })
      version.current = res.version
      if (latest.current === content) dirty.current = false
      setStatus(dirty.current ? 'pending' : 'saved')
      // Card mentions create links server-side; refresh the linked-task chips when they change.
      const nextMentions = extractReferences(content).cards.sort().join(',')
      if (nextMentions !== mentions.current) {
        mentions.current = nextMentions
        void queryClient.invalidateQueries({ queryKey: keys.page(page.id) })
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setConflict({ by: null })
        setStatus('error')
      } else {
        setStatus('error')
        toast.error(errorMessage(error))
      }
    } finally {
      saving.current = false
      if (dirty.current && !conflictRef.current) timer.current = setTimeout(() => void save(), 400)
    }
  }, [page.id])

  // Flush on unmount / page change, and warn before leaving with unsaved edits.
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      clearTimeout(timer.current)
      if (dirty.current && !conflictRef.current) {
        void patch(`/pages/${page.id}`, { content: latest.current, baseVersion: version.current }).catch(() => {})
      }
    }
  }, [page.id])

  const reloadFromServer = useCallback(
    async (by?: string) => {
      const fresh = await get<PageDTO>(`/pages/${page.id}`)
      version.current = fresh.version
      latest.current = fresh.content
      dirty.current = false
      editorRef.current?.commands.setContent(fresh.content, { contentType: 'markdown', emitUpdate: false })
      queryClient.setQueryData(keys.page(page.id), fresh)
      if (!titleFocused.current) setTitle(fresh.title)
      setConflict(null)
      setStatus('idle')
      if (by) toast(t('page.agentUpdated', { name: by }), { icon: <Bot className="size-4 text-agent" />, duration: 2500 })
    },
    [page.id, t],
  )

  // Live updates from agents or other sessions.
  useEffect(
    () =>
      onPageEvent((event) => {
        if (event.pageId !== page.id || event.action === 'page.deleted') return
        // Only changes to the text carry a version. Attachments and links leave it
        // alone: refresh the side lists, never the editor, or a just-pasted image
        // could be wiped before it is saved.
        if (event.version === undefined) {
          void queryClient.invalidateQueries({ queryKey: keys.page(page.id) })
          return
        }
        if (event.version <= version.current) return
        const self = event.actor.kind === 'user' && event.actor.id === me.user.id
        if (self && saving.current) return
        if (dirty.current) setConflict({ by: event.actor.name })
        else void reloadFromServer(event.actor.kind === 'agent' ? event.actor.name : undefined)
      }),
    [page.id, me.user.id, reloadFromServer],
  )

  async function keepMine() {
    const fresh = await get<PageDTO>(`/pages/${page.id}`)
    version.current = fresh.version
    setConflict(null)
    conflictRef.current = false
    dirty.current = true
    await save()
  }

  function saveMeta(patchBody: { title?: string; icon?: string | null }) {
    void patch<{ version: number }>(`/pages/${page.id}`, patchBody)
      .then((res) => {
        version.current = Math.max(version.current, res.version)
        return queryClient.invalidateQueries({ queryKey: keys.overview(workspaceId) })
      })
      .catch((error) => toast.error(errorMessage(error)))
  }

  const projectPages = overview?.projects.find((p) => p.id === page.projectId)?.pages ?? []
  const statusLabel = status === 'idle' ? '' : t(`page.status.${status}`)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumbs={[
          { label: page.project.name, to: `/w/${workspaceId}/p/${page.project.id}` },
          ...page.breadcrumbs.map((b) => ({ label: `${b.icon ? `${b.icon} ` : ''}${b.title || t('untitled')}`, to: `/w/${workspaceId}/d/${b.id}` })),
          { label: `${icon ? `${icon} ` : ''}${title || t('untitled')}` },
        ]}
        actions={
          <>
            <span className={cn('mr-2 text-[12px] max-sm:hidden', status === 'error' ? 'text-danger' : 'text-ink-3')} aria-live="polite">
              {statusLabel}
            </span>
            <MenuRoot>
              <MenuTrigger asChild>
                <Button variant="ghost" size="sm" iconOnly icon={<Ellipsis />} aria-label={t('page.actions')} />
              </MenuTrigger>
              <MenuContent>
                <MenuItem icon={<FilePlus />} onSelect={() => void actions.createPage(page.projectId, page.id)}>
                  {t('page.newSubpage')}
                </MenuItem>
                <MenuItem icon={<FolderInput />} onSelect={() => setMoveOpen(true)}>
                  {t('page.move')}
                </MenuItem>
                <MenuSeparator />
                <MenuItem
                  icon={<Trash />}
                  danger
                  onSelect={async () => {
                    dirty.current = false
                    if (await actions.deletePage({ id: page.id, title })) navigate(page.parentId ? `/w/${workspaceId}/d/${page.parentId}` : `/w/${workspaceId}/p/${page.projectId}`)
                  }}
                >
                  {t('page.delete')}
                </MenuItem>
              </MenuContent>
            </MenuRoot>
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <article className="mx-auto w-full max-w-[780px] px-6 pt-12 sm:px-12 sm:pt-16">
          <div className="group/title">
            <IconPicker
              value={icon}
              onChange={(next) => {
                setIcon(next)
                saveMeta({ icon: next })
              }}
            />
            <textarea
              ref={titleRef}
              value={title}
              rows={1}
              maxLength={200}
              placeholder={t('untitled')}
              aria-label={t('page.titleLabel')}
              onFocus={() => (titleFocused.current = true)}
              onBlur={() => (titleFocused.current = false)}
              onChange={(e) => {
                const next = e.target.value.replace(/\n/g, '')
                setTitle(next)
                clearTimeout(titleTimer.current)
                titleTimer.current = setTimeout(() => saveMeta({ title: next.trim() }), 500)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || (e.key === 'ArrowDown' && e.currentTarget.selectionStart === title.length)) {
                  e.preventDefault()
                  const editor = editorRef.current
                  if (editor) {
                    // Synchronous focus so fast typing continues in the body, not the title.
                    editor.view.focus()
                    editor.commands.setTextSelection(1)
                  }
                }
              }}
              className="mt-2 block w-full resize-none overflow-hidden bg-transparent font-display text-[40px] leading-[1.1] font-medium tracking-[-0.025em] outline-none placeholder:text-ink-3 sm:text-[44px]"
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12.5px] text-ink-3">
            {page.updatedBy && (
              <span className="inline-flex items-center gap-1.5">
                {page.updatedBy.kind === 'agent' && <Bot className="size-3.5 text-agent" />}
                <Trans
                  t={t}
                  i18nKey="page.editedBy"
                  values={{ name: page.updatedBy.name, time: relativeTime(page.updatedAt) }}
                  components={{ name: <span className={page.updatedBy.kind === 'agent' ? 'font-medium text-agent' : 'font-medium text-ink-2'} /> }}
                />
              </span>
            )}
            {agent && (
              <span className="animate-pop inline-flex items-center gap-1 rounded-full bg-agent-soft px-2 py-0.5 font-medium text-agent">
                <span className="live-dot size-1.5" /> {t('page.agentWorking', { name: agent })}
              </span>
            )}
          </div>

          {page.cards.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5" aria-label={t('page.linkedTasks')}>
              {page.cards.map((c) => (
                <Link
                  key={c.id}
                  to={`/w/${workspaceId}/b/${c.boardId}?card=${c.id}`}
                  className={cn('group inline-flex h-7 max-w-full items-center gap-1.5 rounded-[8px] border border-line bg-surface pr-2 pl-1.5 text-[12.5px] shadow-sm transition-colors hover:border-line-strong', c.archived && 'opacity-60')}
                  title={`${c.boardName} · ${c.columnName}`}
                >
                  <SquareKanban className="size-3.5 shrink-0 text-accent" />
                  <span className="truncate font-medium">{c.title}</span>
                  <span className="shrink-0 text-ink-3">{c.columnName}</span>
                  {c.dueAt && <DueChip dueAt={c.dueAt} className="-mr-1" />}
                </Link>
              ))}
            </div>
          )}

          {conflict && (
            <div role="alert" className="animate-pop mt-6 flex flex-wrap items-center gap-3 rounded-[12px] border border-warn/40 bg-[color-mix(in_oklab,var(--warn)_10%,var(--sheet))] px-4 py-3 text-[13px]">
              <TriangleAlert className="size-4 shrink-0 text-warn" />
              <span className="min-w-0 flex-1">
                {conflict.by ? (
                  <Trans t={t} i18nKey="page.conflict.byName" values={{ name: conflict.by }} components={{ strong: <strong className="font-semibold" /> }} />
                ) : (
                  <Trans t={t} i18nKey="page.conflict.byOtherSession" components={{ strong: <strong className="font-semibold" /> }} />
                )}
              </span>
              <Button size="sm" variant="secondary" onClick={() => void reloadFromServer()}>
                {t('page.conflict.loadTheirs')}
              </Button>
              <Button size="sm" variant="primary" onClick={() => void keepMine()}>
                {t('page.conflict.keepMine')}
              </Button>
            </div>
          )}

          <div className="mt-8">
            <Editor
              content={page.content}
              workspaceId={workspaceId}
              upload={{ type: 'page', id: page.id }}
              onUploaded={() => void queryClient.invalidateQueries({ queryKey: keys.page(page.id) })}
              ariaLabel={t('page.content')}
              onReady={(editor) => (editorRef.current = editor)}
              onChange={(md) => {
                latest.current = md
                dirty.current = true
                setStatus('pending')
                clearTimeout(timer.current)
                timer.current = setTimeout(() => void save(), 700)
              }}
            />
          </div>

          {(page.children.length > 0 || page.attachments.length > 0) && (
            <footer className="-mt-[22vh] mb-24 flex flex-col gap-8 border-t border-line pt-8">
              {page.children.length > 0 && (
                <section>
                  <h2 className="mb-3 text-[11.5px] font-semibold tracking-[0.08em] text-ink-3 uppercase">{t('page.subpages')}</h2>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {page.children.map((c) => (
                      <Link key={c.id} to={`/w/${workspaceId}/d/${c.id}`} className="group flex items-center gap-3 rounded-[12px] border border-line bg-surface px-3 py-2.5 shadow-sm transition-all hover:-translate-y-px hover:border-line-strong hover:shadow-md">
                        <CornerDownRight className="size-3.5 text-ink-4" />
                        <span className="text-[15px]">{c.icon ?? <FileText className="size-4 text-ink-3" />}</span>
                        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{c.title || t('untitled')}</span>
                        <span className="text-[11.5px] text-ink-3">{relativeTime(c.updatedAt)}</span>
                      </Link>
                    ))}
                  </div>
                </section>
              )}
              {page.attachments.length > 0 && (
                <section>
                  <h2 className="mb-3 flex items-center gap-2 text-[11.5px] font-semibold tracking-[0.08em] text-ink-3 uppercase">
                    <Paperclip className="size-3.5" /> {t('page.attachments')}
                  </h2>
                  <Attachments items={page.attachments} target={{ type: 'page', id: page.id }} onChanged={() => void queryClient.invalidateQueries({ queryKey: keys.page(page.id) })} />
                </section>
              )}
            </footer>
          )}
        </article>
      </div>
      <MovePageDialog open={moveOpen} onOpenChange={setMoveOpen} pageId={page.id} projectName={page.project.name} pages={projectPages} workspaceId={workspaceId} />
    </div>
  )
}
