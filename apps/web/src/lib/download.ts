import { toast } from 'sonner'
import { ApiError, errorMessage } from './api'
import { keys, queryClient } from './queries'

/**
 * Downloads what the server answers at `url` (`/api/…`) as a file: the page stays where it is. The
 * session is checked first: ended, the browser would open the error the server answers instead
 * (JSON, in English); this way the app says it, and asks to sign in again.
 */
export async function downloadFrom(url: string) {
  // Asked again as the app asks it: ended, the app goes to sign in (see AppShell).
  await queryClient.refetchQueries({ queryKey: keys.me })
  const { error } = queryClient.getQueryState(keys.me) ?? {}
  if (error) {
    if (!(error instanceof ApiError && error.status === 401)) toast.error(errorMessage(error))
    return
  }
  window.location.assign(url)
}
