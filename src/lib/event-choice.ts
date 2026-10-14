import type { Card } from './agent'
import { startOfDay } from './core'
import { clockTime, namedDay, parseRange } from './parse'

type EventCard = Extract<Card, { type: 'event' }>
const CLOCK = /\b\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?/gi
const FILLER = /\b(?:i|the|a|at|to|and|from|until|till|hanggang|choose|chose|pick|use|take|prefer|go|with|that|this|one|time|slot|instead|works|for|me|please|pls|yes|okay|ok|sige|yung|ung|iyon|yan|na|lang|nalang|po|mo|today|ngayon)\b/gi

/** A reply to the actual offered slot; never let a model replace it with the original clashing time. */
export function suggestedSlotReply(text: string, card: EventCard, now: number): 'alt' | 'clarify' | null {
  if (!card.alt || /\?|\b(?:not|no|don'?t|never|hindi|wag|huwag|what|when|why|could|can|would|ano|bakit|kailan)\b/i.test(text)) return null
  const clean = text.toLowerCase().replace(/[.,!"“”]/g, '').trim()
  if (!card.moveOther && /^(?:use |choose |i choose |sige )?(?:your suggestion|the suggestion|the suggested time|the recommended time|yung suggestion mo|yung suggested time)(?: na lang| nalang| please| po)?$/.test(clean)) return 'alt'
  const day = namedDay(text, now)
  if (day != null && day !== startOfDay(card.alt.start)) return null
  const remainder = text.replace(CLOCK, ' ').replace(/\b\d{1,2}(?::\d{2})?\b/g, ' ').replace(FILLER, ' ').replace(/[\s.,!"“”–—-]/g, '')
  if (remainder) return null // A new activity or unsupported wording is not permission to add the old card.
  const clocks = [...text.matchAll(CLOCK)].map(m => clockTime(m[0])).filter((t): t is [number, number] => !!t)
  const minutes = (t: number) => new Date(t).getHours() * 60 + new Date(t).getMinutes()
  const clockMinutes = clocks.map(([h, m]) => h * 60 + m)
  if (clockMinutes.length === 2) {
    if (clockMinutes[0] === clockMinutes[1]) return 'clarify'
    return clockMinutes[0] === minutes(card.alt.start) && clockMinutes[1] === minutes(card.alt.end) ? 'alt' : null
  }
  const range = parseRange(text, card.alt.start)
  if (range) return range.start === card.alt.start && range.end === card.alt.end ? 'alt' : null
  return clockMinutes.length === 1 && clockMinutes[0] === minutes(card.alt.start) ? 'alt' : null
}
