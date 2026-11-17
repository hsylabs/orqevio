import { type RestoredDTO, TRASH_DAYS, type TrashedDTO } from '@orqevio/shared'
import { t } from 'i18next'
import { toast } from 'sonner'
import { errorMessage, post } from './api'
import { queryClient } from './queries'

/** "You can bring it back from the trash for 30 days.", for delete confirmations. */
export const trashNote = () => t('trash:note', { count: TRASH_DAYS })

/** Takes an entry out of the trash and refreshes whatever it may have gone back into. */
export async function restoreFromTrash(trashId: string) {
  const restored = await post<RestoredDTO>(`/trash/${trashId}/restore`)
  // Requests already under way finish: a restore touches many queries, cancelling them is wasted work.
  await queryClient.invalidateQueries(undefined, { cancelRefetch: false })
  return restored
}

/** Tells that something went to the trash, with a button to bring it back at once. */
export function toastTrashed(message: string, result: TrashedDTO | undefined | void) {
  const trashId = result ? result.trashId : null
  toast.success(message, {
    description: t('trash:toast.description'),
    ...(trashId && {
      action: {
        label: t('trash:toast.undo'),
        onClick: () => {
          restoreFromTrash(trashId)
            .then((restored) => {
              if (restored.movedTo) toast.message(t('trash:restoredElsewhere', { place: restored.movedTo }))
            })
            .catch((error) => toast.error(errorMessage(error)))
        },
      },
    }),
  })
}
