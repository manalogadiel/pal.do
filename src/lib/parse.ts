// On-device parsing. English + common Taglish/casual phrasing. No network, no model.
import { addDays, at, startOfDay, type Kind, type TaskKind } from './core'

const DAYS: [RegExp, number][] = [
  [/\b(sun(day)?|linggo)\b/i, 0],
  [/\b(mon(day)?|lunes)\b/i, 1],
  [/\b(tue(s|sday)?|martes)\b/i, 2],
  [/\b(wed(nesday)?|miyerkules|miyerkoles)\b/i, 3],
  [/\b(thu(r|rs|rsday)?|huwebes)\b/i, 4],
  [/\b(fri(day)?|biyernes|byernes)\b/i, 5],
  [/\b(sat(urday)?|sabado)\b/i, 6],
]
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

const NEXT_WEEK = /\b(next week|sa susunod na linggo|susunod na linggo)\b/i
const RANGE = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|nn)?\s*(?:-|–|—|to|until|till|hanggang|ang\s+gang)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|nn|noon)?(?![\d/:])/i
const CLOCK = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/i

export interface When {
  t: number
  hadTime: boolean
}

function to24(h: number, ap?: string) {
  if (!ap) return h
  if (/^(nn|noon)$/i.test(ap)) return 12
  const pm = ap.toLowerCase().startsWith('p')
  if (pm && h < 12) return h + 12
  if (!pm && h === 12) return 0
  return h
}

const WEEKDAY_WORD = String.raw`mon(?:day)?|lunes|tue(?:s|sday)?|martes|wed(?:nesday)?|miyerkules|miyerkoles|thu(?:r|rs|rsday)?|huwebes|fri(?:day)?|biyernes|byernes|sat(?:urday)?|sabado|sun(?:day)?|linggo`
/** "tom" is texting for tomorrow, unless it's someone named Tom ("dinner with Tom", "kasama si tom") */
const TOM = String.raw`(?<!\b(?:with|si|kay|ni|and|kasama|&)\s+)tom(?![\w'])`
const DAY_WORD = String.raw`(?:today|ngayon|tonight|mamaya(?:ng)?|tomorrow|tomorow|tommorow|tommorrow|tmorrow|tmrw|tmr|${TOM}|bukas|sa makalawa|${WEEKDAY_WORD})`
/** "mamaya hindi bukas", "today not tomorrow", "instead of saturday": the day after the "not" is the wrong one */
const NOT_DAY = new RegExp(String.raw`\b(?:hindi|di|not|instead of|wag|huwag)\s+(?:sa\s+|ng\s+)?${DAY_WORD}\b`, 'gi')
const ANY_DAY = new RegExp(String.raw`\b${DAY_WORD}\b|\bin \d+ days?\b|\b(?:${MONTHS.join('|')})[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}\/\d{1,2}\b`, 'gi')

function dayBase(text: string, now: number): number | null {
  const s = text.toLowerCase().replace(NOT_DAY, ' ')
  const today = startOfDay(now)
  if (/\b(today|ngayon|tonight|mamaya|mamayang|later)\b/.test(s)) return today
  if (/\b(day after tomorrow|sa makalawa)\b/.test(s)) return addDays(today, 2)
  if (/\b(tomorrow|tomorow|tommorow|tommorrow|tmorrow|tmrw|tmr|bukas)\b/.test(s) || new RegExp(String.raw`\b${TOM}`).test(s)) return addDays(today, 1)
  const inN = s.match(/\bin (\d+) days?\b/)
  if (inN) return addDays(today, +inN[1])
  const md = s.match(new RegExp(`\\b(${MONTHS.join('|')})[a-z]*\\.?\\s+(\\d{1,2})\\b`))
  if (md) {
    const d = new Date(now)
    d.setMonth(MONTHS.indexOf(md[1]), +md[2])
    d.setHours(0, 0, 0, 0)
    if (d.getTime() < today) d.setFullYear(d.getFullYear() + 1)
    return d.getTime()
  }
  const slash = s.match(/\b(\d{1,2})\/(\d{1,2})\b/)
  if (slash) {
    const d = new Date(now)
    d.setMonth(+slash[1] - 1, +slash[2])
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  const nextWeek = NEXT_WEEK.test(s)
  const cleaned = s.replace(NEXT_WEEK, ' ')
  for (const [re, dow] of DAYS) {
    if (re.test(cleaned)) {
      let delta = (dow - new Date(today).getDay() + 7) % 7
      if (new RegExp(`next\\s+${re.source.replace(/\\b/g, '')}`, 'i').test(cleaned) || nextWeek) delta = delta === 0 ? 7 : delta + (nextWeek ? 7 : 0)
      return addDays(today, delta)
    }
  }
  if (nextWeek) return addDays(today, 7)
  return null
}

function timeOfDay(text: string): [number, number] | null {
  const s = text.toLowerCase()
  const c = s.match(CLOCK)
  if (c) return [to24(+c[1], c[3]), c[2] ? +c[2] : 0]
  const h24 = s.match(/\bat (\d{1,2}):(\d{2})\b/)
  if (h24) return [+h24[1], +h24[2]]
  if (/\b(midnight|hatinggabi)\b/.test(s)) return [23, 59]
  if (/\b(noon|tanghali)\b/.test(s)) return [12, 0]
  if (/\b(tonight|mamayang gabi|gabi|evening)\b/.test(s)) return [21, 0]
  if (/\b(hapon|afternoon)\b/.test(s)) return [15, 0]
  if (/\b(umaga|morning)\b/.test(s)) return [9, 0]
  return null
}

// A spoken "a" / "an" needs a space after it: "4:30 am mamaya" is not "a m(inute) later"
const N = String.raw`(\d+(?:\.\d+)?|(?:an?|one|isang|half an?)(?=\s))`
const UNIT = String.raw`(h|hr|hrs|hour|hours|oras|m|min|mins|minutes|minuto)`
const REL_BEFORE = new RegExp(String.raw`\b(?:in|after|within|pagkatapos ng)\s+${N}\s*${UNIT}\b`, 'i')
const REL_AFTER = new RegExp(String.raw`\b${N}\s*${UNIT}\s+(?:after|later|from now|mamaya|mula ngayon)\b`, 'i')

/** "in 1 hour", "1 hour after", "30 mins from now", "after 2 hrs" → now + offset (rounded up to 5 min) */
function relative(text: string, now: number): number | null {
  const m = text.match(REL_BEFORE) ?? text.match(REL_AFTER)
  if (!m) return null
  const n = /^half/i.test(m[1]) ? 0.5 : /^(an?|one|isang)$/i.test(m[1]) ? 1 : +m[1]
  const mins = /^(m|min|mins|minutes|minuto)$/i.test(m[2]) ? n : n * 60
  const step = 5 * 60 * 1000
  return Math.ceil((now + mins * 60 * 1000) / step) * step
}

/** "in 2 hours" / "30 mins mula ngayon": the number is when it starts, not how long it lasts */
export const isRelative = (text: string) => REL_BEFORE.test(text) || REL_AFTER.test(text)

export function parseWhen(text: string, now: number): When | null {
  const rel = relative(text, now)
  if (rel != null) return { t: rel, hadTime: true }
  const base = dayBase(text, now)
  const tod = timeOfDay(text)
  if (base == null && !tod) return null
  if (base == null && tod) {
    let t = at(startOfDay(now), tod[0], tod[1])
    if (t < now) t = addDays(t, 1)
    return { t, hadTime: true }
  }
  return { t: at(base!, tod ? tod[0] : 23, tod ? tod[1] : 59), hadTime: !!tod }
}

export function parseRange(text: string, now: number): { start: number; end: number } | null {
  const m = text.match(RANGE)
  if (!m) return null
  const a = +m[1], b = +m[4]
  if (a > 23 || b > 23) return null
  // a bare "3-4" with no context is too ambiguous (could be a score or a count)
  if (!m[3] && !m[6] && !/\b(class|klase|lecture|lab|shift|duty|work|from|gym|practice|training|meeting|org|tutor)\b/i.test(text)) return null
  const base = dayBase(text, now) ?? startOfDay(now)
  const sm = m[2] ? +m[2] : 0
  const em = m[5] ? +m[5] : 0
  // School-hours guess when am/pm is missing: 7–11 → morning, 12 → noon, 1–6 → afternoon
  const guess = (h: number) => (h >= 7 && h <= 11 ? h : h === 12 ? 12 : h >= 1 && h <= 6 ? h + 12 : h)
  let startH = m[3] ? to24(a, m[3]) : m[6] ? to24(a, m[6]) : guess(a)
  let endH = m[6] ? to24(b, m[6]) : guess(b)
  // "9-12am" / "9-12" → 12 means noon after a morning start
  if (endH === 0 && startH > 0) endH = 12
  // "11-1pm": shared suffix made the start pm too; pull it back to morning
  if (!m[3] && m[6] && startH * 60 + sm >= endH * 60 + em) startH = a === 12 ? 12 : a
  // still inverted? push the end 12h later ("1-3" read as 1am–3am → 1pm–3pm handled by guess; "8-2" → 8am–2pm)
  if (endH * 60 + em <= startH * 60 + sm && endH + 12 <= 24) endH += 12
  const start = at(base, startH, sm)
  const end = at(base, Math.min(endH, 23), endH >= 24 ? 59 : em)
  return end > start ? { start, end } : null
}

const DAY_TOKENS: [RegExp, number][] = [
  [/\b(mon(day)?s?|lunes)\b/i, 1],
  [/\b(tue(s|sday)?s?|martes)\b/i, 2],
  [/\b(wed(nesday)?s?|miyerkules|miyerkoles)\b/i, 3],
  [/\b(thu(r|rs|rsday)?s?|huwebes)\b/i, 4],
  [/\b(fri(day)?s?|biyernes|byernes)\b/i, 5],
  [/\b(sat(urday)?s?|sabado)\b/i, 6],
  [/\b(sun(day)?s?|linggo)\b/i, 0],
]

/** Recurring weekdays: "MWF", "TTh", "M/W", "every Mon", "Mon and Wed", "daily", "weekdays". 0=Sun. */
export function parseDays(text: string): number[] | null {
  const s = ` ${text} `
  if (/\b(daily|every ?day|araw-araw)\b/i.test(s)) return [1, 2, 3, 4, 5, 6, 0]
  if (/\b(weekdays?|mon(day)?\s*(-|to|thru|through)\s*fri(day)?)\b/i.test(s)) return [1, 2, 3, 4, 5]
  if (/\b(weekends?)\b/i.test(s)) return [6, 0]
  // compact codes: MWF, TTh, TTH, MW, TF, M/W/F, Th
  const code = s.match(/(?:^|\s)((?:M|T|W|Th|TH|F|S|Su)(?:\/?(?:M|T|W|Th|TH|F|S|Su)){1,5})(?=\s|$|[,.])/)
  if (code) {
    const out: number[] = []
    const re = /Su|Th|TH|M|T|W|F|S/g
    let t: RegExpExecArray | null
    while ((t = re.exec(code[1].replace(/\//g, '')))) {
      const d = { M: 1, T: 2, W: 3, Th: 4, TH: 4, F: 5, S: 6, Su: 0 }[t[0]]
      if (d != null && !out.includes(d)) out.push(d)
    }
    if (out.length >= 2) return out
  }
  const found = DAY_TOKENS.filter(([re]) => re.test(s)).map(([, d]) => d)
  const recurring = /\b(every|tuwing|each)\b/i.test(s) || /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*days\b/i.test(s) || found.length >= 2
  if (found.length && recurring) return found
  return null
}

export function hasSingleDay(text: string, now: number) {
  return dayBase(text, now) != null
}

/**
 * The one day a message names ("mamaya", "bukas", "sabado", "oct 17"), with "hindi bukas" crossed out.
 * Null when it names none, or two different ones ("prelims sabado, review bukas").
 */
export function namedDay(text: string, now: number): number | null {
  const s = text.toLowerCase().replace(NOT_DAY, ' ')
  const d = dayBase(s, now)
  if (d == null) return null
  const seen = new Set((s.match(ANY_DAY) ?? []).map((w) => dayBase(w, now)))
  return seen.size > 1 ? null : d
}

/** The one clock time a message gives ("10 am", "at 14:30", "noon"), or null when none or more than one */
export function clockTime(text: string): [number, number] | null {
  const s = text.toLowerCase()
  const all = s.match(new RegExp(CLOCK.source, 'gi')) ?? []
  if (all.length > 1) return null
  if (all.length === 1) {
    const c = all[0].match(CLOCK)!
    return [to24(+c[1], c[3]), c[2] ? +c[2] : 0]
  }
  const h24 = s.match(/\bat (\d{1,2}):(\d{2})\b/)
  if (h24) return [+h24[1], +h24[2]]
  return /\b(noon|tanghali)\b/.test(s) ? [12, 0] : null
}

export function parseHours(text: string): number | null {
  const s = text.toLowerCase()
  const h = s.match(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|oras)\b/)
  if (h) return +h[1]
  const m = s.match(/(\d+)\s*(m|min|mins|minutes|minuto)\b/)
  if (m) return +m[1] / 60
  if (/\b(half an hour|30 ?mins?)\b/.test(s)) return 0.5
  if (/\b(an hour|one hour|isang oras)\b/.test(s)) return 1
  if (/\b(couple (of )?hours|dalawang oras)\b/.test(s)) return 2
  if (/\b(few hours|ilang oras)\b/.test(s)) return 3
  const bare = s.match(/^\s*(\d+(?:\.\d+)?)\s*$/)
  if (bare && +bare[1] <= 40) return +bare[1]
  return null
}

export function taskKind(text: string): TaskKind | null {
  if (/\b(exam|test|quiz|midterms?|finals?|prelims?|long test|recit|recitation|quarterly)\b/i.test(text)) return 'exam'
  if (/\b(essay|paper|report|project|assignment|homework|hw|lab report|thesis|reflection|presentation|reading|module|worksheet|research|portfolio|plate|requirement)\b/i.test(text)) return 'assignment'
  return null
}

export function eventKind(text: string): Kind | null {
  if (/\b(shift|duty|work at|part[- ]time|raket|trabaho)\b/i.test(text)) return 'shift'
  // "may pasok ako 7am": pasok is going to class
  if (/\b(class(es)?|lecture|klase|lab|seminar|tutorial|pasok|school|eskwela|iskul)\b/i.test(text)) return 'class'
  if (/\b(commute|bus|jeep|train|biyahe)\b/i.test(text)) return 'commute'
  if (/\b(gym|family|church|simba|dinner|lunch|date|rest)\b/i.test(text)) return 'protected'
  return null
}

const STRIP = [
  RANGE, CLOCK, NEXT_WEEK, REL_BEFORE, REL_AFTER,
  /^\s*(hey|hi|hello|yo|uy|bosing|boss)\b/gi,
  // "pede ba ako mag meeting": asking, not part of the title ("mag-review" keeps its verb)
  /\b(pwede|puwede|pede|pwd|can i|could i|may i|is it ok(ay)? (if|to)|okay lang ba)\b/gi,
  /\bmag(?=\s)/gi,
  /\bat \d{1,2}:\d{2}\b/gi,
  /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|oras|m|min|mins|minutes)\b/gi,
  /\bin \d+ days?\b/gi,
  new RegExp(`\\b(${MONTHS.join('|')})[a-z]*\\.?\\s+\\d{1,2}\\b`, 'gi'),
  /\b\d{1,2}\/\d{1,2}\b/g,
  /\b(today|tonight|later|tomorrow|tomorow|tommorow|tommorrow|tmorrow|tmrw|tmr|bukas|ngayon|mamaya(ng)?|gabi|hapon|umaga|morning|afternoon|evening|noon|midnight|day after)\b/gi,
  new RegExp(String.raw`\b${TOM}`, 'gi'),
  // Taglish fillers ("may exam ako e", "bukas pa naman"), never part of a title. "E-commerce" keeps its E.
  /(?<![\w-])(e+h*|naman|lang|daw|raw|pala|talaga|kasi|nga)(?![\w-])/gi,
  ...DAYS.map(([re]) => new RegExp(re.source, 'gi')),
  // "I'm going to…", "I will attend…", "it is my…": how they said it, not what it is
  /\b(it will|it would|it starts?|it ends?|i'?m|i am|we'?re|we are|i will|i'?ll|we will|gonna|going to|going|attend(?:ing)?|join(?:ing)?|it is|it was|there'?s)(?![\w-])/gi,
  // "I would like to schedule a dinner", "can you book…": the asking, not the title
  /\b(i would like to|i'?d like to|id like to|i would like|would like to|i want to|i wanna|want to|can you|could you|will you|set up|book|create)(?![\w-])/gi,
  /\b(i have|i've got|i got|got|there's|there is|i need to|need to|have to|gotta|i need|kailangan ko|kailangan|may|meron|ako|ko|mo|ung|yung|ang|sa|ng|para|na|pa|ba|deadline|due|until|before|by|on|at|this|next|my|a|an|the|i|is|it's|its|to|for|of|and|please|pls|po|paki|add|put|schedule|sched|plan|lagyan|ilagay|lagay|remind me|help me)\b/gi,
  /\b(every|each|tuwing|daily|weekdays|weekends?|from|klase|class(es)?)\b/gi,
  /(?:^|\s)(?:M|T|W|Th|TH|F|S|Su)(?:\/?(?:M|T|W|Th|TH|F|S|Su)){1,5}(?=\s|$)/g,
  /[,.!?;:]/g,
]

/** A title explicitly supplied by the user keeps its words, including Tagalog prepositions. */
export function suppliedEventTitle(text: string): string | null {
  const named = text.match(/^\s*(?:ang\s+)?(?:title|pangalan|name)(?:\s+(?:nito|niya|ng\s+(?:plano|plan)|of\s+(?:it|this|the\s+plan)))?\s+(?:ay|is|:)\s*(.+)$/i)
    ?? text.match(/^\s*(?:the\s+)?title\s+(?:is|of\s+this\s+is)\s+(.+)$/i)
    ?? text.match(/^\s*(?:title|pangalan|name)\s*:\s*(.+)$/i)
  if (!named) return null
  const details = named[1]
  const clock = [details.match(RANGE)?.index, details.match(CLOCK)?.index].filter((i): i is number => i != null)
  const title = details.slice(0, clock.length ? Math.min(...clock) : undefined)
    .replace(/[\s,;]+(?:from|at|mula|starts?\s+at)\s*$/i, '')
    .replace(/^[\s"“]+|[\s,;.!"”]+$/g, '')
  return title || null
}

export function extractTitle(text: string, fallback: string) {
  // "birthday party of Ana" → "Ana's birthday party" (the "of" would be stripped and leave "birthday party Ana")
  text = text.replace(/\b((?:birthday|bday)(?: party)?|party|wedding|debut|despedida|celebration|graduation)\s+of\s+(?:my\s+)?([A-Z][\w-]*|\w+)/i, "$2's $1")
  let s = ` ${text} `
  for (const re of STRIP) s = s.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'), ' ')
  s = s.replace(/\s+/g, ' ').trim()
  if (s.length < 2) return fallback
  s = s.length > 42 ? s.slice(0, 40).trim() + '…' : s
  return s.replace(/^./, (c) => c.toUpperCase())
}

export function isYes(t: string) {
  return /^\s*(yes|yep|yeah|yup|sure|ok(ay)?|oks|oki+e?|go|sige|sge+|oo|g|game|tama|correct|right|looks right|do it|sounds good)\b/i.test(t)
}
export function isNo(t: string) {
  return /^\s*(no|nope|nah|hindi|wag|huwag|not now|later|cancel|never ?mind)\b/i.test(t)
}
