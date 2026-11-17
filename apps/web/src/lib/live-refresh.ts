import type { QueryClient, QueryKey } from '@tanstack/react-query'

/** How long changes are gathered before the queries they touch are refetched. */
export const GATHER_MS = 100
/** How long the next refetch waits for the one under way, at most, before going ahead anyway. */
export const WAIT_AT_MOST_MS = 3000

/**
 * Live changes come in bursts: an agent creating fifty pages sends fifty events in a second.
 * Refetching on each one cancels the refetch still under way every time, so most requests are
 * thrown away, and Safari's network process fails under that many cancelled requests. Instead,
 * changes are gathered for a moment and each query they touch is refetched once. While those
 * refetches are under way, new changes wait for them to finish instead of cancelling them,
 * and are refetched together next.
 */
export function createLiveRefresh(client: QueryClient) {
  const pending = new Map<string, QueryKey>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let refetching = false

  const schedule = () => {
    if (timer === undefined && !refetching && pending.size) timer = setTimeout(() => void flush(), GATHER_MS)
  }

  async function flush() {
    timer = undefined
    const queryKeys = [...pending.values()]
    pending.clear()
    refetching = true
    let giveUp: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        Promise.all(queryKeys.map((queryKey) => client.invalidateQueries({ queryKey }))),
        // A request that hangs must not hold back every live change after it.
        new Promise((resolve) => (giveUp = setTimeout(resolve, WAIT_AT_MOST_MS))),
      ])
    } finally {
      clearTimeout(giveUp)
      refetching = false
      schedule()
    }
  }

  return {
    /** Refetches the queries under `queryKey` soon, together with the other changes of the moment. */
    refresh(queryKey: QueryKey) {
      pending.set(JSON.stringify(queryKey), queryKey)
      schedule()
    },
    /** Drops a refetch not started yet, for something just deleted: there is nothing left to fetch. */
    forget(queryKey: QueryKey) {
      pending.delete(JSON.stringify(queryKey))
    },
  }
}
