import type {
  BackupsDTO,
  ActivityDTO,
  AnonymousSessionDTO,
  BoardDTO,
  CardDetailDTO,
  CardSummaryDTO,
  HistoryEntryDTO,
  HomeDTO,
  MeDTO,
  OverviewDTO,
  PageDTO,
  SearchResultDTO,
  TokenDTO,
  TrashEntryDTO,
  UpdateStatusDTO,
} from '@orqevio/shared'
import { QueryClient, keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ApiError, get } from './api'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
    mutations: { retry: false },
  },
})

export const keys = {
  me: ['me'] as const,
  access: ['access'] as const,
  overview: (wid: string) => ['overview', wid] as const,
  home: (wid: string) => ['home', wid] as const,
  board: (id: string) => ['board', id] as const,
  archived: (id: string) => ['archived', id] as const,
  card: (id: string) => ['card', id] as const,
  page: (id: string) => ['page', id] as const,
  search: (wid: string, q: string) => ['search', wid, q] as const,
  tokens: ['tokens'] as const,
  updates: ['updates'] as const,
  activity: (wid: string, filter: string) => ['activity', wid, filter] as const,
  vault: ['vault'] as const,
  vaultItems: ['vault-items'] as const,
  trash: (wid: string) => ['trash', wid] as const,
  history: (type: 'page' | 'card', id: string) => ['history', type, id] as const,
  historyEntry: (id: string) => ['history-entry', id] as const,
  backups: ['backups'] as const,
}

export const useMe = () =>
  useQuery({
    queryKey: keys.me,
    queryFn: async ({ signal }) => {
      const session = await get<MeDTO | AnonymousSessionDTO>('/auth/session', signal)
      if (!session.user) {
        // Keep the sign-in screens' view in sync, so they never act on a stale signed-in state.
        queryClient.setQueryData(keys.access, session)
        throw new ApiError(401, 'unauthorized', 'Authentication required')
      }
      return session as MeDTO
    },
    staleTime: 60_000,
  })

/** Raw session, including whether this copy is claimed yet (sign-in screens). */
export const useAccessState = () =>
  useQuery({
    queryKey: keys.access,
    queryFn: ({ signal }) => get<MeDTO | AnonymousSessionDTO>('/auth/session', signal),
    staleTime: 0,
  })

export const useOverview = (wid: string | undefined) =>
  useQuery({
    queryKey: keys.overview(wid ?? ''),
    queryFn: ({ signal }) => get<OverviewDTO>(`/workspaces/${wid}/overview`, signal),
    enabled: Boolean(wid),
  })

export const useHome = (wid: string) =>
  useQuery({ queryKey: keys.home(wid), queryFn: ({ signal }) => get<HomeDTO>(`/workspaces/${wid}/home`, signal) })

export const useBoard = (id: string) =>
  useQuery({ queryKey: keys.board(id), queryFn: ({ signal }) => get<BoardDTO>(`/boards/${id}`, signal) })

export const useArchived = (id: string, enabled: boolean) =>
  useQuery({ queryKey: keys.archived(id), queryFn: ({ signal }) => get<CardSummaryDTO[]>(`/boards/${id}/archived`, signal), enabled })

export const useCard = (id: string | null) =>
  useQuery({ queryKey: keys.card(id ?? ''), queryFn: ({ signal }) => get<CardDetailDTO>(`/cards/${id}`, signal), enabled: Boolean(id) })

export const usePage = (id: string) =>
  useQuery({ queryKey: keys.page(id), queryFn: ({ signal }) => get<PageDTO>(`/pages/${id}`, signal), staleTime: 5_000 })

export const useSearch = (wid: string, q: string, type?: 'card' | 'page') =>
  useQuery({
    queryKey: [...keys.search(wid, q), type ?? 'all'],
    queryFn: ({ signal }) =>
      get<SearchResultDTO[]>(`/workspaces/${wid}/search?q=${encodeURIComponent(q)}${type ? `&type=${type}` : ''}`, signal),
    enabled: q.trim().length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  })

export const useTrash = (wid: string) =>
  useQuery({ queryKey: keys.trash(wid), queryFn: ({ signal }) => get<TrashEntryDTO[]>(`/workspaces/${wid}/trash`, signal) })

/** The changes of a page or a card, newest first, 50 at a time. */
export const useHistory = (type: 'page' | 'card', id: string, enabled: boolean) =>
  useInfiniteQuery({
    queryKey: keys.history(type, id),
    queryFn: ({ signal, pageParam }) =>
      get<HistoryEntryDTO[]>(
        `/${type}s/${id}/history?limit=${HISTORY_PAGE}${pageParam ? `&before=${encodeURIComponent(pageParam.updatedAt)}&beforeId=${pageParam.id}` : ''}`,
        signal,
      ),
    // The next page starts after the last entry: its time, and the entry itself for changes made in the same millisecond.
    initialPageParam: null as Pick<HistoryEntryDTO, 'id' | 'updatedAt'> | null,
    getNextPageParam: (last: HistoryEntryDTO[]) => (last.length < HISTORY_PAGE ? undefined : { id: last.at(-1)!.id, updatedAt: last.at(-1)!.updatedAt }),
    enabled,
  })
const HISTORY_PAGE = 50

/** One change with its texts before and after. Edits merged into it update it, so it follows `updatedAt`. */
export const useHistoryEntry = (id: string, updatedAt: string, enabled: boolean) =>
  useQuery({
    queryKey: [...keys.historyEntry(id), updatedAt],
    queryFn: ({ signal }) => get<HistoryEntryDTO>(`/history/${id}`, signal),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  })

export const useTokens = () => useQuery({ queryKey: keys.tokens, queryFn: ({ signal }) => get<TokenDTO[]>('/tokens', signal) })

/**
 * Asked once an hour while the app is open, so a version published meanwhile
 * shows up without reloading; the copy itself checks the registry at most every
 * 12 hours, so this costs nothing outside.
 */
const UPDATES_EVERY_MS = 60 * 60 * 1000
/** The copy's backups (Settings): where they are and the ones kept. */
export const useBackups = () => useQuery({ queryKey: keys.backups, queryFn: ({ signal }) => get<BackupsDTO>('/backups', signal) })

export const useUpdates = () =>
  useQuery({
    queryKey: keys.updates,
    queryFn: ({ signal }) => get<UpdateStatusDTO>('/updates', signal),
    staleTime: UPDATES_EVERY_MS,
    refetchInterval: UPDATES_EVERY_MS,
    refetchOnWindowFocus: false,
    retry: false,
  })

export const useActivity = (wid: string, opts: { agentsOnly?: boolean; tokenId?: string } = {}) => {
  const params = new URLSearchParams({ limit: '40' })
  if (opts.agentsOnly) params.set('agents', '1')
  if (opts.tokenId) params.set('tokenId', opts.tokenId)
  return useQuery({
    queryKey: keys.activity(wid, params.toString()),
    queryFn: ({ signal }) => get<ActivityDTO[]>(`/workspaces/${wid}/activity?${params}`, signal),
  })
}
