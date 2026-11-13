import type { BoardDTO, CardSummaryDTO } from '@orqevio/shared'
import { describe, expect, it } from 'vitest'
import { withNewCard } from '../src/features/boards/board-cache'

const card = (id: string, title = 'Revisar el informe'): CardSummaryDTO => ({
  id,
  boardId: 'b1',
  columnId: 'c1',
  title,
  position: 'a0',
  dueAt: null,
  labelIds: [],
  hasDescription: false,
  checklist: { done: 0, total: 0 },
  linkedPages: 0,
  attachments: 0,
  createdBy: null,
  createdAt: '2026-11-13T12:00:00.000Z',
  updatedAt: '2026-11-13T12:00:00.000Z',
})
const board = (cards: CardSummaryDTO[]): BoardDTO => ({
  id: 'b1',
  projectId: 'p1',
  workspaceId: 'w1',
  name: 'Tablero',
  project: { id: 'p1', name: 'Diseño', color: 'tomato' },
  columns: [],
  cards,
  labels: [],
})

describe('adding a new card to the cached board', () => {
  it('appends it', () => {
    const before = board([card('a', 'Otra')])
    const after = withNewCard(before, card('b'))
    expect(after.cards.map((c) => c.id)).toEqual(['a', 'b'])
    expect(before.cards).toHaveLength(1)
  })

  it('does not add it twice when the live refetch already brought it', () => {
    // The refetch triggered by the card's own live event landed before the creation response.
    const refetched = board([card('a', 'Otra'), { ...card('b'), title: 'Revisar el informe (editado)' }])
    const after = withNewCard(refetched, card('b'))
    expect(after.cards.map((c) => c.id)).toEqual(['a', 'b'])
    // The refetched copy is at least as fresh as the creation response: keep it.
    expect(after.cards[1]!.title).toBe('Revisar el informe (editado)')
    expect(after).toBe(refetched)
  })
})
