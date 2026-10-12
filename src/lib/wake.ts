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

/**
 * How a name sounds, roughly: speech-to-text writes "Jhyvie" as "Jay Hivey", "Jay Highby", "Jayvee", "JV".
 * h drops out, y/ee/ie/ey all become i, b becomes v, jh/ch/g become j, doubles collapse.
 * "jay hivey" → "jaivi", "jayvee" → "jaivi", "jhyvie" → "jivi".
 */
export function soundKey(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/^g(?=[iey])|jh|ch/g, 'j')
    .replace(/ph/g, 'f')
    .replace(/h/g, '')
    .replace(/(ee|ie|ei|ea|ey)/g, 'i')
    .replace(/y/g, 'i')
    .replace(/b/g, 'v')
    .replace(/(.)\1+/g, '$1')
}

function distance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}

/** Sounds like one of the pal's names: exact for short keys ("rai", "jp"), one sound off for longer ones */
const soundsLike = (key: string, keys: string[]) => keys.some((k) => (k.length <= 3 || key.length <= 3 ? key === k : distance(key, k) <= 1))

/**
 * Pal's own line coming back through the mic while it talks ("Hiii, Jhyvie here!" has the wake phrase in it).
 * What came after the wake phrase is mostly Pal's words → echo. A bare "Hi Jhyvie" is an echo only when Pal's
 * line itself says it. "Hi Jhyvie stop" over any line is never an echo.
 */
export function isEcho(heard: string, line: string, pal: PalId) {
  if (!line.trim()) return false
  const words = (s: string) => norm(s).split(' ').filter(Boolean)
  const said = new Set(words(line))
  const rest = words(matchWake(heard, pal)?.command ?? heard)
  if (!rest.length) return matchWake(line, pal) != null
  return rest.filter((w) => said.has(w)).length / rest.length >= 0.6
}

/** Typed names only: sound-alikes like "deal" or "ray" are real words in a typed message */
const TYPED: Record<PalId, string[]> = {
  jhyvie: ['jhyvie', 'jhivie', 'jhyvee', 'jivie', 'jhy', 'jv'],
  jaypee: ['jaypee', 'jaypi', 'jp'],
  rei: ['rei'],
  diel: ['diel'],
}
const palName = (id: PalId) => id[0].toUpperCase() + id.slice(1)

/**
 * "Hi Jhyvie", "Jhyvie, add my exam", "thanks jv" sent to another pal: the name they used, and the rest of the
 * message (a request still gets handled). Null when they used this pal's name or no name at all.
 */
export function wrongPal(text: string, pal: PalId, userName?: string): { wrong: string; rest: string } | null {
  const s = norm(text)
  const user = userName ? norm(userName) : ''
  for (const id of Object.keys(TYPED) as PalId[]) {
    if (id === pal) continue
    const names = TYPED[id].filter((n) => n !== user && !TYPED[pal].includes(n)).join('|')
    if (!names) continue
    // The rest comes from the original text, so "4:30pm" and "what's" survive
    const head = new RegExp(String.raw`^\s*${FILLER}(?:${GREETING}[\s,!.]+)?(?:${names})(?![\w'])[\s,!.:]*(.*)$`, 'i').exec(text)
    if (head) return { wrong: palName(id), rest: head[1].trim() }
    if (new RegExp(String.raw`(?:^|\s)(?:${GREETING}|thanks|thank you|ty|salamat)\s+(?:${names})$`).test(s)) return { wrong: palName(id), rest: '' }
    // "add my exam, jhyvie": a name after a comma at the very end
    const tail = new RegExp(String.raw`^(.*),\s*(?:${names})[.!?\s]*$`, 'i').exec(text.trim())
    if (tail) return { wrong: palName(id), rest: tail[1].trim() }
  }
  return null
}

/** Sound-alikes that are everyday words: "okay deal" or "hey ray" is not someone calling Diel or Rei */
const EVERYDAY = new Set(['deal', 'dial', 'ray', 'rey', 'rae', 'dil', 'deel', 'jay p', 'j p', 'gv', 'jay v', 'j v'])

/**
 * "Hey Jhyvie" heard while Rei is listening: the other pal's name and what came after it, or null.
 * Stricter than waking: a real greeting (hi/hey/hello) and a known spelling of the name, never a sound-alike.
 */
export function wakesOtherPal(heard: string, pal: PalId, userName?: string): { wrong: string; command: string } | null {
  const text = norm(heard)
  const head = /^(?:hi+|hey|hello)\s+(.+)$/.exec(text)
  if (!head || matchWake(heard, pal, userName)) return null
  const user = userName ? norm(userName) : ''
  for (const id of Object.keys(NAMES) as PalId[]) {
    if (id === pal) continue
    const names = NAMES[id].filter((n) => n !== user && !EVERYDAY.has(n)).sort((a, b) => b.length - a.length)
    for (const n of names) {
      const m = new RegExp(String.raw`^${n.replace(/ /g, String.raw`\s*`)}(?:\s+|$)(.*)$`).exec(head[1])
      if (m) return { wrong: palName(id), command: m[1].trim() }
    }
  }
  return null
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
  // Sounds like the name over the next 1–3 words ("jay hivey", "jay highby"), but never the user's own name
  const keys = names.map(soundKey)
  const userKey = user ? soundKey(user) : ''
  const words = rest.split(' ')
  for (let k = 1; k <= Math.min(3, words.length); k++) {
    const key = soundKey(words.slice(0, k).join(''))
    if (key && key !== userKey && soundsLike(key, keys)) return { command: words.slice(k).join(' ').trim() }
  }
  return null
}
