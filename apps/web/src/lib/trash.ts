import { type RestoredDTO, TRASH_DAYS, type TrashedDTO, type TrashPlanDTO } from '@orqevio/shared'
import { t } from 'i18next'
import { toast } from 'sonner'
import { ApiError, del, errorMessage, post } from './api'
import { queryClient } from './queries'

/** "You can bring it back from the trash for 30 days.", for delete confirmations. */
export const trashNote = () => t('trash:note', { count: TRASH_DAYS })

/** Goes to a place in the app from outside a component (a toast's button). */
export const openInApp = (href: string) => void import('../router').then(({ router }) => router.navigate(href))

/** Where something of the trash is shown in it: its row, opened and highlighted. */
export const trashHref = (workspaceId: string, key: string) => `/w/${workspaceId}/trash?item=${encodeURIComponent(key)}`

/** What restoring something from the trash asks: see `trashRestoreInput`. */
export interface RestoreRequest {
  key: string
  exclude?: string[]
  to?: { kind: 'original' } | { kind: 'recreate' } | { kind: 'other'; parent: { kind: string; id: string } }
  names?: Record<string, string>
  keepNames?: string[]
  include?: string[]
}

/** What restoring would do, without doing it. */
export const planRestore = (workspaceId: string, request: RestoreRequest) => post<TrashPlanDTO>(`/workspaces/${workspaceId}/trash/restore`, { ...request, dryRun: true })

/** Everything a restore may have touched is refetched; requests under way finish (cancelling them is wasted work). */
const refreshAll = () => queryClient.invalidateQueries(undefined, { cancelRefetch: false })

/** Restores something from the trash as asked, and refreshes whatever it went back into. */
export async function restoreItem(workspaceId: string, request: RestoreRequest) {
  const restored = await post<RestoredDTO>(`/workspaces/${workspaceId}/trash/restore`, request)
  await refreshAll()
  return restored
}

/** Deletes something in the trash for good, with everything below it. */
export async function purgeItem(workspaceId: string, key: string) {
  await del(`/workspaces/${workspaceId}/trash/${encodeURIComponent(key)}`)
  await refreshAll()
}

/** Puts back exactly what one deletion took away, where it was (undoing it), and refreshes. */
export async function restoreFromTrash(trashId: string) {
  const restored = await post<RestoredDTO>(`/trash/${trashId}/restore`)
  await refreshAll()
  return restored
}

/** Where to find in the trash what holds something that can't go back yet, from a refused restore. */
export function holderOf(error: unknown): { title: string; key?: string } | null {
  if (!(error instanceof ApiError) || error.code !== 'restore_place_in_trash') return null
  const details = error.details as { title?: string; key?: string } | undefined
  return { title: details?.title ?? '', key: details?.key }
}

/**
 * Tells that something went to the trash, with a button to bring it back at once: as it was,
 * where it was. If that can't be (what held it went to the trash meanwhile), it says so, with
 * a way to the trash.
 */
export function toastTrashed(message: string, result: TrashedDTO | undefined | void) {
  const trashId = result ? result.trashId : null
  toast.success(message, {
    description: t('trash:toast.description'),
    ...(trashId && {
      action: {
        label: t('trash:toast.undo'),
        onClick: () => {
          restoreFromTrash(trashId).catch((error) => {
            const holder = holderOf(error)
            if (!holder) return toast.error(errorMessage(error))
            const workspace = window.location.pathname.match(/^\/w\/([^/]+)/)?.[1]
            toast.error(t('trash:restoreFirst', { name: holder.title || t('common:untitled') }), {
              ...(holder.key && workspace && { action: { label: t('trash:openInTrash'), onClick: () => openInApp(trashHref(workspace, holder.key!)) } }),
            })
          })
        },
      },
    }),
  })
}
