import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GATHER_MS, WAIT_AT_MOST_MS, createLiveRefresh } from '../src/lib/live-refresh'

/** A query client whose refetches finish when the test says so. */
function fakeClient() {
  const calls: QueryKey[] = []
  const done: Array<() => void> = []
  const client = {
    invalidateQueries: vi.fn(({ queryKey }: { queryKey: QueryKey }) => {
      calls.push(queryKey)
      return new Promise<void>((resolve) => done.push(resolve))
    }),
  }
  const finish = () => {
    for (const resolve of done.splice(0)) resolve()
  }
  return { client: client as unknown as QueryClient, calls, finish, spy: client.invalidateQueries }
}

describe('live refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('gathers the changes of a moment and refetches each query once', async () => {
    const { client, calls } = fakeClient()
    const live = createLiveRefresh(client)
    for (let i = 0; i < 50; i++) {
      live.refresh(['overview', 'w1'])
      live.refresh(['home', 'w1'])
    }
    live.refresh(['board', 'b1'])
    await vi.advanceTimersByTimeAsync(GATHER_MS - 1)
    expect(calls).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toEqual([['overview', 'w1'], ['home', 'w1'], ['board', 'b1']])
  })

  it('never cancels its own refetches: what comes meanwhile waits for them, then goes together', async () => {
    const { client, calls, finish, spy } = fakeClient()
    const live = createLiveRefresh(client)
    live.refresh(['overview', 'w1'])
    await vi.advanceTimersByTimeAsync(GATHER_MS)
    expect(calls).toHaveLength(1)
    // Changes during the refetch: nothing new starts, so the one under way isn't cancelled.
    live.refresh(['overview', 'w1'])
    live.refresh(['activity', 'w1'])
    await vi.advanceTimersByTimeAsync(GATHER_MS * 5)
    expect(calls).toHaveLength(1)
    finish()
    await vi.advanceTimersByTimeAsync(GATHER_MS)
    expect(calls).toEqual([['overview', 'w1'], ['overview', 'w1'], ['activity', 'w1']])
    // Each refetch keeps React Query's default, which cancels only fetches started elsewhere.
    expect(spy).toHaveBeenCalledWith({ queryKey: ['activity', 'w1'] })
  })

  it("doesn't let a refetch that hangs hold back the changes after it", async () => {
    const { client, calls } = fakeClient()
    const live = createLiveRefresh(client)
    live.refresh(['board', 'b1'])
    await vi.advanceTimersByTimeAsync(GATHER_MS)
    live.refresh(['board', 'b1'])
    await vi.advanceTimersByTimeAsync(WAIT_AT_MOST_MS - 1)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1 + GATHER_MS)
    expect(calls).toEqual([['board', 'b1'], ['board', 'b1']])
  })

  it('drops a refetch not started yet for something just deleted', async () => {
    const { client, calls } = fakeClient()
    const live = createLiveRefresh(client)
    live.refresh(['card', 'c1'])
    live.refresh(['board', 'b1'])
    live.forget(['card', 'c1'])
    await vi.advanceTimersByTimeAsync(GATHER_MS)
    expect(calls).toEqual([['board', 'b1']])
  })

  it('does nothing when nothing changed', async () => {
    const { client, calls } = fakeClient()
    createLiveRefresh(client)
    await vi.advanceTimersByTimeAsync(WAIT_AT_MOST_MS * 2)
    expect(calls).toEqual([])
  })
})
