import { toast } from 'sonner'
import { ApiError, errorMessage } from './api'
import { keys, queryClient } from './queries'

/**
 * Downloads what the server answers at `url` (`/api/…`, same origin) as a file: the page stays where it is. The
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
  // A link to follow as a download, whatever the answer is: Safari would open a text (Markdown) in
  // place of the app instead of saving it.
  const link = document.createElement('a')
  link.href = url
  link.download = ''
  link.hidden = true
  document.body.append(link)
  link.click()
  link.remove()
}
