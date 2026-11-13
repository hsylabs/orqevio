import type { BoardDTO, CardSummaryDTO } from '@orqevio/shared'

/**
 * Adds a card created here to the cached board. The live update for that same card
 * may have refetched the board first, and then it is already there (at least as
 * fresh as the creation response): it must not appear twice.
 */
export function withNewCard(board: BoardDTO, card: CardSummaryDTO): BoardDTO {
  return board.cards.some((c) => c.id === card.id) ? board : { ...board, cards: [...board.cards, card] }
}
