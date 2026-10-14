import type { Card } from "./study-material"
export type CardMode = "swipe" | "recall" | "quiz"
export interface CardProgress {
  key: string
  fileId: string
  attempts: number
  correct: number
  lastReviewedAt: number
  modes: Partial<Record<CardMode, { attempts: number; correct: number }>>
}
// Full content is part of identity: even reused IDs cannot inherit another card's history.
export function cardProgressKey(fileId: string, card: Card): string {
  return JSON.stringify([fileId, card.id, card.front, card.back])
}
export function practiceQueue(
  fileId: string,
  cards: Card[],
  progress: CardProgress[],
): number[] {
  const history = new Map(progress.map((p) => [p.key, p]))
  return cards
    .map((_, i) => i)
    .sort((a, b) => {
      const score = (i: number) => {
        const p = history.get(cardProgressKey(fileId, cards[i]))
        return p ? p.attempts - p.correct : 0
      }
      return score(b) - score(a) || a - b
    })
}
export function answerQueue(
  queue: number[],
  position: number,
  correct: boolean,
): number[] {
  const current = queue[position]
  return !correct && queue.filter((i) => i === current).length < 2
    ? [...queue, current]
    : queue
}
export function quizChoices(cards: Card[], index: number): string[] {
  const answer = cards[index].back
  const others = [...new Set(cards.map((c) => c.back))]
    .filter((s) => s !== answer)
    .slice(0, 3)
  if (!others.length) return []
  const choices = [...others, answer]
  // Stable rotation keeps the correct answer from occupying a fixed position.
  const shift = index % choices.length
  return [...choices.slice(shift), ...choices.slice(0, shift)]
}
