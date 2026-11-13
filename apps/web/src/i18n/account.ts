import type { MeDTO } from '@orqevio/shared'
import type { QueryClient } from '@tanstack/react-query'
import { keys } from '../lib/queries'
import { applyLocale } from '.'

/** Once signed in, the account's language wins over this device's, on every device. */
export function followAccountLocale(client: QueryClient) {
  return client.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.query.queryKey[0] !== keys.me[0]) return
    const locale = (event.query.state.data as MeDTO | undefined)?.user.locale
    if (locale) void applyLocale(locale)
  })
}
