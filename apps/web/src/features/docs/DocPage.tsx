import type { ActorRef, PageDTO, RealtimeEvent, TrashTreeDTO } from '@orqevio/shared'
import { MAX_MARKDOWN, characters, extractReferences } from '@orqevio/shared'
import type { Editor as TiptapEditor } from '@tiptap/core'
import { EditorState } from '@tiptap/pm/state'
import { Bot, CornerDownRight, Ellipsis, FileText, FilePlus, FolderInput, History, Paperclip, SquareKanban, Trash, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link, useBlocker, useLocation, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { useConfirm } from '../../components/ui/confirm'
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from '../../components/ui/Menu'
import { ApiError, errorMessage, get, patch } from '../../lib/api'
import { cn } from '../../lib/cn'
import { formatNumber, relativeTime } from '../../lib/format'
import { keys, queryClient, usePage } from '../../lib/queries'
import { onPageEvent, refreshLive, useAgentHighlight } from '../../lib/realtime'
import { Attachments } from '../boards/Attachments'
import { DueChip } from '../boards/CardItem'
import { PageHeader } from '../shell/PageHeader'
import { useStructureActions } from '../shell/actions'
import { NotFound, PageSkeleton } from '../shell/States'
import { useWorkspace } from '../shell/workspace'
import { Editor } from './editor/Editor'
import { IconPicker } from './IconPicker'
import { HistoryDialog } from '../history/HistoryDialog'
import { MovePageDialog } from './MovePageDialog'
import { useRestore } from '../trash/restore'

type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

/**
 * Why the editor is not saving what was written. Only a network failure (or a server that does
 * not answer) is tried again, waiting longer each time; anything else the server refused would
 * only be refused again, so it waits for the next edit or for the person to try again.
 */
type SaveProblem = { kind: 'too_long'; length: number } | { kind: 'retrying'; reason: string } | { kind: 'refused'; reason: string }

/**
 * The page was deleted, maybe with what holds it. `entry` is where it waits in the trash, when it
 * can be found: the deletion it went with, and what that deletion was of when not the page itself.
 */
interface Gone {
  by: ActorRef | null
  entry: { key: string; holder: string | null } | null
}

const isNotFound = (error: unknown) => error instanceof ApiError && error.status === 404
/** Failures that may pass on their own: no connection, a server down or busy. */
const isTransient = (error: unknown) => !(error instanceof ApiError) || error.status === 0 || error.status >= 500 || error.status === 408 || error.status === 429
/** 1 s, 2 s, 4 s… up to 30 s between attempts. */
const retryDelay = (failures: number) => Math.min(30_000, 1000 * 2 ** (failures - 1))

export function DocPage() {
  const { pageId = '' } = useParams()
  const page = usePage(pageId)
  if (!page.data) return page.isError ? <NotFound /> : <PageSkeleton />
  // Already open, a page that is no longer found stays on screen, with what was written in it.
  return <DocBody key={page.data.id} page={page.data} missing={page.isError && isNotFound(page.error)} readAt={page.dataUpdatedAt} />
}

/** `missing`: the page was not found when read again. `readAt`: when it was last read. */
function DocBody({ page, missing, readAt }: { page: PageDTO; missing: boolean; readAt: number }) {
  const { t } = useTranslation('docs')
  const { workspaceId, me, overview } = useWorkspace()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const location = useLocation()
  const actions = useStructureActions(workspaceId)
  const agent = useAgentHighlight(page.id)

  const [title, setTitle] = useState(page.title)
  const [icon, setIcon] = useState(page.icon)
  const [status, setStatus] = useState<SaveStatus>('idle')
  /** Who changed the page under the editor; `by: null` is another session of this user. */
  const [conflict, setConflict] = useState<{ by: string | null } | null>(null)
  const [problem, setProblem] = useState<SaveProblem | null>(null)
  const [gone, setGone] = useState<Gone | null>(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

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
  const problemRef = useRef<SaveProblem | null>(null)
  const goneRef = useRef(false)
  /** Failed attempts in a row, for the wait before the next one. */
  const failures = useRef(0)
  /** This tab is deleting the page: it leaves it, so there is nothing to tell. */
  const deleting = useRef(false)
  const markGone = useRef<(by: ActorRef | null) => void>(() => {})
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

  const report = useCallback((next: SaveProblem | null) => {
    problemRef.current = next
    setProblem(next)
  }, [])

  const save = useCallback(async () => {
    if (saving.current || conflictRef.current || goneRef.current || !dirty.current) return
    clearTimeout(timer.current)
    const content = latest.current
    // The server would refuse it: say so once, and try again when it is short enough. Counted as
    // the server counts, so a page full of emoji that it takes can be saved from here too.
    const length = characters(content)
    if (length > MAX_MARKDOWN) {
      report({ kind: 'too_long', length })
      setStatus('error')
      return
    }
    saving.current = true
    setStatus('saving')
    let retryIn: number | null = null
    try {
      const res = await patch<{ version: number }>(`/pages/${page.id}`, { content, baseVersion: version.current })
      version.current = res.version
      if (latest.current === content) dirty.current = false
      failures.current = 0
      report(null)
      setStatus(dirty.current ? 'pending' : 'saved')
      // Card mentions create links server-side; refresh the linked-task chips when they change.
      const nextMentions = extractReferences(content).cards.sort().join(',')
      if (nextMentions !== mentions.current) {
        mentions.current = nextMentions
        void queryClient.invalidateQueries({ queryKey: keys.page(page.id) })
      }
    } catch (error) {
      setStatus('error')
      if (error instanceof ApiError && error.status === 409) {
        conflictRef.current = true
        setConflict({ by: null })
      } else if (isNotFound(error)) markGone.current(null)
      else if (isTransient(error)) {
        failures.current += 1
        retryIn = retryDelay(failures.current)
        report({ kind: 'retrying', reason: errorMessage(error) })
      } else report({ kind: 'refused', reason: errorMessage(error) })
    } finally {
      saving.current = false
      if (dirty.current && !conflictRef.current && !goneRef.current) {
        if (retryIn !== null) timer.current = setTimeout(() => void save(), retryIn)
        // Written while it was saving.
        else if (!problemRef.current) timer.current = setTimeout(() => void save(), 400)
      }
    }
  }, [page.id, report])

  /** Tries again now, without waiting for the next attempt. */
  const retryNow = useCallback(() => {
    failures.current = 0
    void save()
  }, [save])

  // Back online: no need to wait for the next attempt.
  useEffect(() => {
    const online = () => problemRef.current?.kind === 'retrying' && retryNow()
    window.addEventListener('online', online)
    return () => window.removeEventListener('online', online)
  }, [retryNow])

  /**
   * The page was deleted (by `by`, when known): saving stops, and the person is told, with who
   * deleted it and a way to bring it back from the trash. What was written stays in the editor.
   */
  markGone.current = (by) => {
    if (goneRef.current || deleting.current) return
    goneRef.current = true
    clearTimeout(timer.current)
    report(null)
    setConflict(null)
    setGone({ by, entry: null })
    // It may have gone with what holds it, an ancestor page or its project: that is what is told.
    get<TrashTreeDTO | null>(`/workspaces/${workspaceId}/trash/${encodeURIComponent(`page:${page.id}`)}`)
      .then((tree) => {
        if (!tree) return
        const { node, ancestors } = tree
        const holder = ancestors.find((a) => a.trashId === node.trashId)
        if (goneRef.current) setGone({ by: node.deletedBy, entry: { key: node.key, holder: holder ? holder.title : null } })
      })
      .catch(() => {})
  }

  /** Back from the trash, here or elsewhere: saving goes on where it left off. */
  const backAgain = useCallback(() => {
    if (!goneRef.current) return
    goneRef.current = false
    setGone(null)
    if (dirty.current) void save()
  }, [save])

  /** Something was restored elsewhere: maybe this page. Says whether it is back. */
  const recheck = useCallback(async () => {
    try {
      const fresh = await get<PageDTO>(`/pages/${page.id}`)
      queryClient.setQueryData(keys.page(page.id), fresh)
      backAgain()
      return true
    } catch {
      // Still in the trash.
      return false
    }
  }, [page.id, backAgain])

  // Restoring brings it back with what is below it; if what holds it is in the trash too, it asks where.
  const restoring = useRestore(workspaceId, {
    onRestored: () => {
      void recheck().then((back) => {
        // The button goes away with the notice: writing goes on where it was.
        if (back) editorRef.current?.commands.focus()
      })
    },
  })

  // What reading the page again finds, also after a reconnection that may have missed live
  // events: a page no longer there is gone; one there again while it seemed gone may be back.
  useEffect(() => {
    if (missing) markGone.current(null)
    else if (goneRef.current) void recheck()
  }, [missing, readAt, recheck])

  /** Unsaved text that leaving would lose: it can't be saved now, or saving it failed. */
  const unsaveable = () => dirty.current && (goneRef.current || conflictRef.current || problemRef.current !== null)

  // Leaving within the app asks first; closing or reloading the tab is asked by the browser.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => currentLocation.pathname !== nextLocation.pathname && unsaveable())
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    void confirm({ title: t('page.leave.title'), description: t('page.leave.body'), confirmLabel: t('page.leave.confirm'), danger: true }).then((leave) =>
      leave ? blocker.proceed() : blocker.reset(),
    )
  }, [blocker, confirm, t])

  // Flush on unmount / page change, and warn before leaving with unsaved edits.
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      clearTimeout(timer.current)
      if (dirty.current && !conflictRef.current && !goneRef.current && characters(latest.current) <= MAX_MARKDOWN) {
        void patch(`/pages/${page.id}`, { content: latest.current, baseVersion: version.current }).catch(() => {})
      }
    }
  }, [page.id])

  /** A page read again is gone, or could not be read. */
  const lost = useCallback((error: unknown) => {
    if (isNotFound(error)) markGone.current(null)
    else toast.error(errorMessage(error))
    return null
  }, [])

  const reloadFromServer = useCallback(
    async (by?: string) => {
      const fresh = await get<PageDTO>(`/pages/${page.id}`).catch(lost)
      if (!fresh) return
      version.current = fresh.version
      latest.current = fresh.content
      dirty.current = false
      const editor = editorRef.current
      if (editor) {
        editor.commands.setContent(fresh.content, { contentType: 'markdown', emitUpdate: false })
        // What came from elsewhere is not this person's to undo, and what they did before no longer
        // fits the text: the editor's history starts again here, so Ctrl+Z can't take the new text
        // back (and save the page without it), nor scramble it.
        const { doc, plugins, selection } = editor.state
        editor.view.updateState(EditorState.create({ doc, plugins, selection }))
      }
      queryClient.setQueryData(keys.page(page.id), fresh)
      if (!titleFocused.current) setTitle(fresh.title)
      setConflict(null)
      report(null)
      setStatus('idle')
      if (by) toast(t('page.agentUpdated', { name: by }), { icon: <Bot className="size-4 text-agent" />, duration: 2500 })
    },
    [page.id, t, report, lost],
  )

  /** The page itself was deleted, or what holds it: a page above it, or its project. */
  const deletesThis = useCallback(
    (event: RealtimeEvent) =>
      (event.action === 'page.deleted' && (event.pageId === page.id || page.breadcrumbs.some((b) => b.id === event.pageId))) ||
      (event.action === 'project.deleted' && event.projectId === page.projectId),
    [page.id, page.breadcrumbs, page.projectId],
  )

  // Live updates from agents or other sessions.
  useEffect(
    () =>
      onPageEvent((event) => {
        if (goneRef.current) {
          if (event.action === 'trash.restored') void recheck()
          return
        }
        if (deletesThis(event)) return markGone.current(event.actor)
        // Renamed, given another icon, or a subpage added, moved or deleted: the title, icon and
        // subpages shown come with the page, and change without a new version of its text.
        if (event.structure && (event.pageId === page.id || event.projectId === page.projectId)) refreshLive(keys.page(page.id))
        if (event.pageId !== page.id) return
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
        // From another tab or device of this person: said as another session, not with their own name.
        if (dirty.current) setConflict({ by: self ? null : event.actor.name })
        else void reloadFromServer(event.actor.kind === 'agent' ? event.actor.name : undefined)
      }),
    [page.id, page.projectId, me.user.id, reloadFromServer, recheck, deletesThis],
  )

  async function keepMine() {
    const fresh = await get<PageDTO>(`/pages/${page.id}`).catch(lost)
    if (!fresh) return
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
      .catch(lost)
  }

  const projectPages = overview?.projects.find((p) => p.id === page.projectId)?.pages ?? []
  const statusLabel = status === 'idle' ? '' : t(`page.status.${status}`)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumbs={[
          { label: page.project.name, to: `/w/${workspaceId}/p/${page.project.id}` },
          ...page.breadcrumbs.map((b) => ({ label: `${b.icon ? `${b.icon} ` : ''}${b.title || t('untitled', { ns: 'common' })}`, to: `/w/${workspaceId}/d/${b.id}` })),
          { label: `${icon ? `${icon} ` : ''}${title || t('untitled', { ns: 'common' })}` },
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
                <MenuItem icon={<History />} onSelect={() => setHistoryOpen(true)}>
                  {t('page.history')}
                </MenuItem>
                <MenuSeparator />
                <MenuItem
                  icon={<Trash />}
                  danger
                  onSelect={async () => {
                    // Deleting drops what is not saved yet; not deleting after all saves it as usual.
                    const unsaved = dirty.current
                    deleting.current = true
                    dirty.current = false
                    let deleted = false
                    try {
                      deleted = await actions.deletePage({ id: page.id, title })
                    } catch (error) {
                      toast.error(errorMessage(error))
                    }
                    if (deleted) return navigate(page.parentId ? `/w/${workspaceId}/d/${page.parentId}` : `/w/${workspaceId}/p/${page.projectId}`)
                    deleting.current = false
                    dirty.current = unsaved
                    if (unsaved) void save()
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
              placeholder={t('untitled', { ns: 'common' })}
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

          {/* Pinned while scrolling: what was written last, far down a long page, is what it is about. */}
          <div className="sticky top-3 z-20 mt-6 empty:hidden">
            {conflict && (
              <div role="alert" className="animate-pop flex flex-wrap items-center gap-3 rounded-[12px] border border-warn/40 bg-[color-mix(in_oklab,var(--warn)_10%,var(--sheet))] px-4 py-3 text-[13px] shadow-md">
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

            {gone && (
              <div role="alert" className="animate-pop flex flex-wrap items-center gap-3 rounded-[12px] border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] shadow-md">
                <Trash className="size-4 shrink-0 text-danger" />
                <span className="min-w-0 flex-1">
                  <GoneMessage gone={gone} selfId={me.user.id} /> {gone.entry ? t('page.gone.inTrash') : ''}{' '}
                  {dirty.current && <strong className="font-semibold">{t(gone.entry ? 'page.gone.unsaved' : 'page.gone.unsavedLost')}</strong>}
                </span>
                {gone.entry && (
                  <Button size="sm" variant="primary" loading={restoring.starting !== null} onClick={() => void restoring.start(gone.entry!.key)}>
                    {t('page.gone.restore')}
                  </Button>
                )}
              </div>
            )}

            {problem && !gone && !conflict && (
              <div role="alert" className="animate-pop flex flex-wrap items-center gap-3 rounded-[12px] border border-warn/40 bg-[color-mix(in_oklab,var(--warn)_10%,var(--sheet))] px-4 py-3 text-[13px] shadow-md">
                <TriangleAlert className="size-4 shrink-0 text-warn" />
                <span className="min-w-0 flex-1">
                  {problem.kind === 'too_long'
                    ? t('page.problem.tooLong', { length: formatNumber(problem.length), max: formatNumber(MAX_MARKDOWN) })
                    : t(problem.kind === 'retrying' ? 'page.problem.retrying' : 'page.problem.refused', { reason: problem.reason })}
                </span>
                {problem.kind !== 'too_long' && (
                  <Button size="sm" variant="secondary" onClick={retryNow}>
                    {t('page.problem.retry')}
                  </Button>
                )}
              </div>
            )}
          </div>

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
                // The next attempt, when it is due, takes this too.
                if (problemRef.current?.kind === 'retrying') return
                clearTimeout(timer.current)
                timer.current = setTimeout(() => void save(), 700)
              }}
            />
          </div>

          {(page.children.length > 0 || page.attachments.length > 0) && (
            // It moves up into the space the editor keeps below its text, so it paints above
            // the editor: otherwise the editor takes every click on it.
            <footer className="relative z-10 -mt-[22vh] mb-24 flex flex-col gap-8 border-t border-line pt-8">
              {page.children.length > 0 && (
                <section>
                  <h2 className="mb-3 text-[11.5px] font-semibold tracking-[0.08em] text-ink-3 uppercase">{t('page.subpages')}</h2>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {page.children.map((c) => (
                      <Link key={c.id} to={`/w/${workspaceId}/d/${c.id}`} className="group flex items-center gap-3 rounded-[12px] border border-line bg-surface px-3 py-2.5 shadow-sm transition-all hover:-translate-y-px hover:border-line-strong hover:shadow-md">
                        <CornerDownRight className="size-3.5 text-ink-4" />
                        <span className="text-[15px]">{c.icon ?? <FileText className="size-4 text-ink-3" />}</span>
                        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{c.title || t('untitled', { ns: 'common' })}</span>
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
      <HistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} type="page" id={page.id} name={title || t('untitled', { ns: 'common' })} />
      {restoring.dialog}
    </div>
  )
}

/** Who deleted the page, or what holds it. */
function GoneMessage({ gone, selfId }: { gone: Gone; selfId: string }) {
  const { t } = useTranslation('docs')
  const strong = { strong: <strong className="font-semibold" /> }
  const by = gone.by
  if (!by) return <>{t('page.gone.unknown')}</>
  const you = by.kind === 'user' && by.id === selfId
  // Deleted with what holds it: say what that was.
  const holder = gone.entry?.holder ?? null
  if (holder !== null) return <Trans t={t} i18nKey={you ? 'page.gone.withByYou' : 'page.gone.withByName'} values={{ name: by.name, title: holder }} components={strong} />
  return <Trans t={t} i18nKey={you ? 'page.gone.byYou' : 'page.gone.byName'} values={{ name: by.name }} components={strong} />
}
