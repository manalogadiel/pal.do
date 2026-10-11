// Device commands (timers, reminders, Study session, "what's next") parsed by rules: instant, offline, exact.
// The chat model only sees what these don't catch. English + Taglish, digits or spoken numbers ("five minutes").
import { extractTitle, parseWhen } from './parse'

export type Command =
  | { type: 'setTimer'; seconds: number; warnSeconds?: number }
  | { type: 'setReminder'; at: number; text: string }
  | { type: 'timer'; op: 'left' | 'add' | 'pause' | 'resume' | 'cancel'; seconds?: number }
  | { type: 'study'; op: 'start' | 'pause' | 'resume' | 'skip' | 'stop' | 'left' }
  | { type: 'next' }

const WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, isa: 1, isang: 1, two: 2, dalawa: 2, dalawang: 2, three: 3, tatlo: 3, tatlong: 3, four: 4, apat: 4,
  five: 5, lima: 5, limang: 5, six: 6, anim: 6, seven: 7, pito: 7, eight: 8, walo: 8, nine: 9, siyam: 9, ten: 10, sampu: 10, sampung: 10,
  fifteen: 15, labinlima: 15, twenty: 20, dalawampu: 20, thirty: 30, tatlumpu: 30, 'forty five': 45, forty: 40, fifty: 50, sixty: 60,
}
const NUM = String.raw`(\d+(?:\.\d+)?|half(?: an?)?|kalahating|forty five|${Object.keys(WORDS).filter((w) => w !== 'forty five').join('|')})`
const UNIT = String.raw`(hours?|hrs?|h|oras|minutes?|mins?|m|minuto|minutos|seconds?|secs?|s|segundo|segundos)`
const PART = new RegExp(String.raw`\b${NUM}(?:\s*(?:na|ng))?\s*${UNIT}\b`, 'gi')

const unitSeconds = (u: string) => (/^(h|hrs?|hours?|oras)$/i.test(u) ? 3600 : /^(m|mins?|minutes?|minuto|minutos)$/i.test(u) ? 60 : 1)
const numValue = (n: string) => (/^half|^kalahati/i.test(n) ? 0.5 : WORDS[n.toLowerCase()] ?? Number(n))

/** "5 mins" → 300, "1 min 30 sec" → 90, "kalahating oras" → 1800, "thirty seconds" → 30. Null when there's no length. */
export function parseDuration(text: string): number | null {
  let total = 0
  for (const m of text.matchAll(PART)) {
    // A spoken number needs a real unit: "3 am" isn't "a minute", "as soon as" isn't "a second"
    if (/^[a-z ]+$/i.test(m[1]) && m[2].length === 1) continue
    const n = numValue(m[1])
    if (!Number.isFinite(n)) continue
    total += n * unitSeconds(m[2])
  }
  return total > 0 ? Math.round(total) : null
}

// "remind me last 30 seconds", "warn me at the final minute", "30 seconds before it ends", "huling 30 segundo"
// (the unit is non-capturing here, so the length is always group 1 or 2)
const UNIT_NC = UNIT.replace('(', '(?:')
const WARN = new RegExp(
  String.raw`(?:\b(?:remind|warn|alert|tell|notify)\s+me\s+(?:at\s+|for\s+|on\s+|in\s+)?(?:the\s+)?(?:last|final)\s+|\b(?:sa\s+)?huling\s+)` +
    String.raw`([^,.;]*?${UNIT_NC})(?=$|[\s,.;!?])` +
    String.raw`|\b([^,.;]*?${UNIT_NC})\s+(?:before\s+(?:it\s+|the\s+timer\s+)?(?:ends?|finishes|is\s+up)|bago\s+(?:matapos|mag-?end|maubos))`,
  'i',
)

const TIMER = /\b(timer|countdown|orasan|i-?timer|time me)\b/i
const REMIND = /\b(remind me|paalal(a|ahanan)( mo)?( ako| sa akin)?|ipaalala( mo)?( sa akin)?|i-?remind mo ako|(paki)?sabihan( mo)? ako|pakisabi( mo)? sa akin)\b/i
const STUDY_WORD = /\b(focus|pomodoro|study|aral|session|break)\b/i
const LEFT = /\b(how (much|long)( time)?( is)? left|time left|how long (until|till)|ilang (minuto|segundo|oras)( pa| na lang)|gaano (pa )?katagal( pa)?|remaining)\b/i

/**
 * A device command, or null to let the chat (model or rules) handle the message.
 * `timers`: a timer is counting, so short "pause" / "add 2 minutes" mean it. `study`: the focus session's state.
 */
export function parseCommand(text: string, now: number, ctx: { timers?: boolean; study?: 'idle' | 'running' | 'paused'; cardWaiting?: boolean } = {}): Command | null {
  const t = text.trim()
  const study = ctx.study ?? 'idle'

  // "Set me a timer for 5 mins and remind me last 30 seconds"
  if (TIMER.test(t) && !/\b(cancel|stop|pause|resume|left|tigil|itigil)\b/i.test(t)) {
    const w = t.match(WARN)
    const warnSeconds = w ? parseDuration(w[1] ?? w[2] ?? '') ?? undefined : undefined
    const seconds = parseDuration(w ? t.replace(w[0], ' ') : t)
    if (seconds) return { type: 'setTimer', seconds, warnSeconds }
  }

  // "Remind me in 20 mins to drink water", "remind me at 3pm to call mom", "paalala mo ako mamaya 3pm na uminom"
  if (REMIND.test(t) && !TIMER.test(t)) {
    const when = parseWhen(t, now)
    if (when?.hadTime && when.t > now) {
      // "na mag-review" → "Review": drop the linker and the verb prefix (with its hyphen)
      const what = extractTitle(t.replace(REMIND, ' ').replace(/\b(to|na|para|mag)\b-?/gi, ' '), 'Reminder')
      return { type: 'setReminder', at: when.t, text: what }
    }
  }

  // Study session: "start focus", "skip break", "stop the pomodoro". "Start studying Friday 3pm" is planning, not now.
  if (/^\W*(start|begin|simulan|umpisahan)\b.*\b(focus|pomodoro|study session|aral|pag-?aaral)\b/i.test(t) && !parseWhen(t, now)) return { type: 'study', op: 'start' }
  if (study !== 'idle' && /\bskip\b.*\bbreak\b|\bskip( na)?\b$/i.test(t)) return { type: 'study', op: 'skip' }

  // "How much time left?": a timer first, else the focus session
  if (LEFT.test(t)) {
    if (ctx.timers && !(study !== 'idle' && STUDY_WORD.test(t))) return { type: 'timer', op: 'left' }
    if (study !== 'idle') return { type: 'study', op: 'left' }
  }

  // "Add 2 minutes", "dagdagan mo ng 5 minuto"
  if (ctx.timers && /\b(add|plus|extend|dagdag(an)?( mo)?)\b/i.test(t)) {
    const s = parseDuration(t)
    if (s) return { type: 'timer', op: 'add', seconds: s }
  }

  // Short controls: "pause", "resume", "cancel the timer", "stop focus"
  const op = /^\W*(?:please\s+|pakis?\s+)?(pause|i-?pause|resume|continue|ituloy|tuloy|cancel|stop|itigil|tigil|i-?stop|i-?cancel)\b/i.exec(t)?.[1]?.toLowerCase()
  // With a card waiting, a bare "cancel that" answers the card, not the timer
  if (op && t.split(/\s+/).length <= 5 && !(ctx.cardWaiting && !TIMER.test(t) && !STUDY_WORD.test(t))) {
    const verb = /pause/.test(op) ? 'pause' : /resume|continue|tuloy/.test(op) ? 'resume' : /cancel/.test(op) ? 'cancel' : 'stop'
    const aboutStudy = STUDY_WORD.test(t) || (!ctx.timers && study !== 'idle')
    if (aboutStudy && study !== 'idle') return { type: 'study', op: verb === 'cancel' ? 'stop' : verb }
    if (ctx.timers && (TIMER.test(t) || !STUDY_WORD.test(t))) return { type: 'timer', op: verb === 'stop' ? 'cancel' : verb }
  }

  // "What's next?", "how's my day?", "ano meron ako ngayon?"
  if (/\b(what'?s next|what is next|ano(ng)? (ang )?(next|susunod)|sunod ko|how'?s my day|my day today|ano(ng)? (ang )?(meron|gagawin) (ako |ko )?(ngayon|today))\b/i.test(t)) return { type: 'next' }

  return null
}
