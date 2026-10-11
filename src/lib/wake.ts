// "Hi Jhyvie, set me a timer…": does a heard sentence start with a greeting + this pal's name?
// Speech-to-text spells names its own way ("Hi JV", "Hey Jivi", "Hi Jaybee"), so each pal has known spellings
// plus a one-letter-off match. A greeting is required: a name said on its own in the room doesn't wake Pal.
import type { PalId } from './core'

const GREETING = String.raw`(?:hi|hii+|hey|hay|hai|hello|helo|hallo|uy|oy|hoy|ok|okay)`
const FILLER = String.raw`(?:(?:uh|um|uhm|ah|eh|oh|so)\s+)?`

const NAMES: Record<PalId, string[]> = {
  jhyvie: ['jhyvie', 'jhyvee', 'jhivie', 'jivie', 'jivi', 'jivee', 'jivy', 'jiv', 'jibi', 'jaivee', 'jayvee', 'jayvie', 'jaybee', 'jay vee', 'jay v', 'j v', 'jv', 'javi', 'javee', 'jeevie', 'jeevee', 'chivi', 'gv', 'jhy'],
  jaypee: ['jaypee', 'jay pee', 'jaypi', 'jaipee', 'jeypee', 'jeepee', 'jay p', 'j p', 'jp'],
  rei: ['rei', 'ray', 'rey', 'rae'],
  diel: ['diel', 'deal', 'dial', 'deel', 'dyel', 'diehl', 'dil'],
}

// Apostrophes vanish ("what's" → "whats", which the command rules expect); other punctuation becomes a space
const norm = (s: string) => s.toLowerCase().replace(/['’]/g, '').replace(/[.,!?;:"()]/g, ' ').replace(/\s+/g, ' ').trim()

function oneOff(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1 || a === b) return a === b
  let i = 0, j = 0, edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else { i++; j++ }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

/**
 * The command after "Hi {pal}" ('' when they only said the greeting), or null when this isn't a wake phrase.
 * `userName`: never wake on the user's own name ("hi Gadiel" from a friend).
 */
export function matchWake(heard: string, pal: PalId, userName?: string): { command: string } | null {
  const text = norm(heard)
  const user = userName ? norm(userName) : ''
  const names = NAMES[pal].filter((n) => n !== user).sort((a, b) => b.length - a.length)
  const head = new RegExp(String.raw`^${FILLER}${GREETING}\s+(.+)$`).exec(text)
  if (!head) return null
  const rest = head[1]
  // Known spellings, longest first ("jay vee" before "jay")
  for (const n of names) {
    const m = new RegExp(String.raw`^${n.replace(/ /g, String.raw`\s*`)}(?:\s+|$)(.*)$`).exec(rest)
    if (m) return { command: m[1].trim() }
  }
  // One letter off a spelling of 4+ letters ("jyvie", "jaypi"), but never the user's own name
  const [word, ...more] = rest.split(' ')
  if (word && word !== user && names.some((n) => n.length >= 4 && !n.includes(' ') && oneOff(word, n))) return { command: more.join(' ').trim() }
  return null
}
