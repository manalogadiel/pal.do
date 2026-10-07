// Pal's brain: scope filter → intent → slot-filling dialog. Deterministic and auditable.
import { fmtDay, fmtHours, fmtTime, type PalId, type PalState, type TaskKind } from './core'
import { eventKind, extractTitle, hasSingleDay, isNo, isYes, parseDays, parseHours, parseRange, parseWhen, taskKind } from './parse'

export interface Draft {
  title: string
  kind: TaskKind
  due?: number
  hours?: number
}
export type Awaiting = null | 'due' | 'hours' | 'confirm'
/** A class/shift we heard but still need weekdays for. */
export interface PendingEvent { title: string; kind: string; start: number; end: number }

export type Card =
  | { type: 'readback'; draft: Draft }
  | { type: 'proposal'; taskId: string; blockIds: string[]; why: string; shortfall: number; freeHours: number; commute?: boolean }
  | { type: 'checkin'; eventIds: string[] }
  | { type: 'event'; title: string; kind: string; start: number; end: number; conflicts: number; whatIf: boolean; days?: number[] }
  | { type: 'notify' }
  | { type: 'boundary' }

export type Action =
  | { type: 'confirmDraft'; draft: Draft }
  | { type: 'addEvent'; title: string; kind: string; start: number; end: number; whatIf: boolean; days?: number[] }
  | { type: 'summary' }
  | { type: 'energy'; value: 'morning' | 'afternoon' | 'evening' }
  | { type: 'openSyllabus' }

export interface Turn {
  text: string
  card?: Card
  chips?: string[]
  mood?: PalState
  draft: Draft | null
  awaiting: Awaiting
  action?: Action
  rule?: string
  /** undefined = leave as is; null = clear */
  pending?: PendingEvent | null
}

/* ---------- Scope filter (runs on input and on any generated output) ---------- */
const GRADED = /\b(write|solve|answer|summari[sz]e|finish|do|complete|gawin|sagutan|paraphrase|translate)\b.*\b(essay|homework|hw|assignment|problem|problems|quiz|paper|report|thesis|reflection|worksheet|module|code)\b|\b(answers? (to|for)|give me the answers?)\b/i
const GRADES = /\b(will i pass|am i (going to|gonna) (pass|fail)|predict|my grade|grades?|gpa|score will|babagsak|pasado)\b/i
const STRESS = /\b(burn(ed|t)? ?out|stressed|anxious|anxiety|depress|overwhelm|panic|can'?t cope|pagod na pagod|suicid|self[- ]harm)\b/i
const INJECT = /\b(ignore (your|all|previous|the) (rules|instructions)|system prompt|you are now|pretend (to be|you)|jailbreak|developer mode|act as)\b/i
const OFFTOPIC = /^(who|what is|what's the|where is|why is|explain|tell me (a joke|about)|how do i (code|make|cook)|write me a (poem|story|song))\b/i

export const BLOCKED_OUTPUT = /\b(you will (pass|fail)|your grade will|you (are|seem) (burned out|depressed|anxious))\b/i

/* ---------- Voice: same logic, four personalities ---------- */
type Lines = Record<string, string[]>
const BASE: Lines = {
  greet: ["Hey! So what's your week looking like?", "Hi hi. What've you got going on this week?"],
  askDue: ["Ooh okay. When's it due?", 'Got it. When do you need it done by?', 'Okay, and the deadline is…?'],
  dueRetry: ['Wait, which day was that? Like "Friday 5pm" or "Oct 18" works.', 'Sorry, missed the day. "Next Tuesday"? "Bukas"?'],
  askHours: ["How long do you think it'll take you?", 'Gut feeling, how many hours?'],
  askHoursExam: ['How much study time do you want before it?', 'How many hours of review feels right?'],
  hoursRetry: ['Just a ballpark is fine, like "3 hours". Or say "not sure" and I\'ll guess.'],
  hoursGuess: ["Let's go with {h} for now. Most people need about that. We can change it."],
  readback: ['Okay, so I got:', 'Lemme make sure I got this right:'],
  fix: ['Sure, what should I change? Like "due Thursday" or "4 hours".'],
  proposal: ["Okay so I'd do it like this. Nothing's on your calendar yet, just say the word.", 'What if we split it up like this?'],
  crunch: ["Hmm, real talk: it needs about {need} but you only have around {free} free before it's due. Maybe trim it down, ask for more time, or move something?"],
  accepted: ["Done, it's in! I'll ask how it went after each one.", "Added. I'll check on you after each block."],
  notNow: ['All good, I saved it. Just say "plan it" whenever.', "Okay, I won't touch your calendar."],
  checkin: ['Hey, did you get to this?', 'So… how did this one go?'],
  checkinMany: ['A few of these went by. How did they go?'],
  doneOk: ['Nice!! Checked off.', 'Yesss, done.'],
  reflow: ["That's okay, happens. I moved the {h} left around, does this work?", 'No stress. Redid the last {h}, want this instead?'],
  reflowNone: ["Nothing left to move. You're good on this one."],
  graded: ["I can't write it for you, but I can save you some focus time for it. How long do you think you need?"],
  grades: ["I honestly can't tell you your grade. I can show how much study time fits before the exam though."],
  stress: ["I can't really tell how you're feeling, but I can look at your week and see what we can move. And if it's getting heavy, the guidance office is there for you."],
  inject: ["Let's stick to your schedule. Anything else coming up?"],
  offtopic: ["Haha I'm only good at planning stuff. Anything coming up this week?"],
  thanks: ['Anytime!', 'Of course :)'],
  unknown: ['Hmm, I didn\'t get that one. Try "Bio exam Friday" or "shift Sat 2-8pm"?', "Sorry, lost me there. What's coming up?"],
  energy: ["Got it, I'll put things in the {v} first."],
  eventAdd: ['Add this?', 'Want me to put this in?'],
  whatIf: ['It would look like this:'],
  notify: ['Want a little heads-up before each block starts?'],
  voiceOn: ["Okay, I'll talk out loud now.", 'Voice on! You can just talk to me too.'],
  askDays: ['{what}, got it. Which days?', 'Okay, {what}. What days do you have it?'],
  daysRetry: ['Which days though? Like "MWF", "TTh", or "just today".'],
}
const VOICE: Record<PalId, Partial<Lines>> = {
  rei: {
    greet: ["Hi, I'm Rei. Tell me about your week, we'll figure it out together."],
    doneOk: ["That one's done. Proud of you.", 'Nice and steady. Checked off.'],
  },
  diel: {
    greet: ["Hey, Diel here. Give me your classes, deadlines, shifts. I like a good schedule."],
    askHours: ['How many hours, roughly?', "What's your estimate in hours?"],
    accepted: ["In the calendar. I'll check in after each block."],
    doneOk: ['Done. Love a clean list.'],
  },
  jhyvie: {
    greet: ['Hiii, Jhyvie here! Kwento mo naman your week, classes, deadlines, raket, lahat.'],
    askDue: ['Sige! Kailan deadline?', 'Okay! When is it due?'],
    askHours: ['Mga ilang oras kaya yan?', 'How many hours you think?'],
    accepted: ["G! Nasa calendar na. Kamustahin kita after each block ha."],
    doneOk: ['Yay, tapos na yan!', 'Galing! Done!'],
    notNow: ['Sige, later na lang. Sabihin mo lang "plan it".'],
  },
  jaypee: {
    greet: ["Yo, Jaypee here! What's the week look like?"],
    askDue: ['When is it due?', 'Deadline?'],
    askHours: ['How many hours?'],
    accepted: ["Locked in! Let's go."],
    doneOk: ["Let's gooo, done!", 'Boom. Checked off.'],
  },
}

let rot = 0
export function say(pal: PalId, key: string, vars: Record<string, string | number> = {}) {
  const pool = VOICE[pal][key] ?? BASE[key] ?? [key]
  let s = pool[rot++ % pool.length]
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v))
  return BLOCKED_OUTPUT.test(s) ? BASE.inject[0] : s
}

export const defaultHours = (k: TaskKind) => (k === 'exam' ? 6 : 4)

/* ---------- One dialog turn ---------- */
export function turn(input: string, ctx: { pal: PalId; now: number; draft: Draft | null; awaiting: Awaiting; pending?: PendingEvent | null }): Turn {
  const { pal, now } = ctx
  const text = input.trim()
  const keep = { draft: ctx.draft, awaiting: ctx.awaiting }
  const out = (key: string, extra: Partial<Turn> = {}, vars?: Record<string, string | number>): Turn => ({
    ...keep, text: say(pal, key, vars), ...extra,
  })

  if (INJECT.test(text)) return out('inject', { rule: 'Scope filter: instruction override' })
  if (STRESS.test(text)) return out('stress', { rule: 'Scope filter: no wellbeing assessment', chips: ['Show my week', 'Find things to move'] })
  if (GRADES.test(text)) return out('grades', { rule: 'Scope filter: no grade predictions' })
  if (GRADED.test(text)) {
    const k = taskKind(text) ?? 'assignment'
    return out('graded', { rule: 'Scope filter: no graded work', draft: { title: extractTitle(text, 'Assignment'), kind: k }, awaiting: 'hours' })
  }

  // Answering "which days?" for a class/shift we already heard
  if (ctx.pending && !parseRange(text, now)) {
    const p = ctx.pending
    const days = parseDays(text)
    const once = /\b(just )?(today|once|this week only|one time|isang beses)\b/i.test(text)
    const single = !days && hasSingleDay(text, now) ? parseWhen(text, now) : null
    if (days || once || single) {
      let { start, end } = p
      if (single) {
        const shift = new Date(single.t).setHours(0, 0, 0, 0) - new Date(start).setHours(0, 0, 0, 0)
        start += shift
        end += shift
      }
      return { ...keep, pending: null, text: '', action: { type: 'addEvent', title: p.title, kind: p.kind, start, end, whatIf: false, days: days ?? undefined } }
    }
    if (isNo(text)) return out('notNow', { pending: null })
    if (text.split(/\s+/).length <= 3) return out('daysRetry', { chips: ['MWF', 'TTh', 'Every weekday', 'Just today'] })
    // They moved on to something else: drop the question and handle the new message
    const r = turn(input, { ...ctx, pending: null })
    return { ...r, pending: r.pending === undefined ? null : r.pending }
  }

  // Fixed events first, so a class mid-task doesn't get eaten as a due date
  const range = parseRange(text, now)
  const ek = eventKind(text)
  const whatIf = /\bwhat if\b|\bpaano kung\b/i.test(text)
  if (range && (ek || whatIf || !taskKind(text))) {
    const kind = ek ?? 'shift'
    const title = extractTitle(text.replace(/\bwhat if\b|\bpaano kung\b/gi, ''), kind === 'class' ? 'Class' : kind === 'protected' ? 'Personal' : 'Shift')
    const days = parseDays(text)
    const dated = hasSingleDay(text, now)
    if (!days && !dated && !whatIf && (kind === 'class' || kind === 'shift')) {
      const what = `${title}, ${fmtTime(range.start)} – ${fmtTime(range.end)}`
      return { ...keep, pending: { title, kind, start: range.start, end: range.end }, text: say(pal, 'askDays', { what }), chips: ['MWF', 'TTh', 'Every weekday', 'Just today'] }
    }
    return { ...keep, pending: null, text: '', action: { type: 'addEvent', title, kind, start: range.start, end: range.end, whatIf, days: days ?? undefined } }
  }

  // Slot filling for the current draft
  if (ctx.draft && ctx.awaiting) {
    const d = { ...ctx.draft }
    if (ctx.awaiting === 'confirm') {
      if (isYes(text)) return { ...keep, text: '', action: { type: 'confirmDraft', draft: d }, awaiting: null }
      if (isNo(text)) return out('notNow', { draft: null, awaiting: null })
    }
    const w = parseWhen(text, now)
    const h = parseHours(text)
    if (w && (ctx.awaiting === 'due' || ctx.awaiting === 'confirm')) d.due = w.t
    if (h && (ctx.awaiting === 'hours' || ctx.awaiting === 'confirm')) d.hours = h
    if (ctx.awaiting === 'hours' && !h && /\b(not sure|idk|no idea|ewan|di ko alam|you decide|ikaw na)\b/i.test(text)) {
      d.hours = defaultHours(d.kind)
      return next(d, say(pal, 'hoursGuess', { h: fmtHours(d.hours) }) + ' ')
    }
    if (ctx.awaiting === 'due' && !w && !h) return out('dueRetry')
    if (ctx.awaiting === 'hours' && !h && !w) return out('hoursRetry')
    if (w || h) return next(d)
  }

  if (/^\s*(hi|hello|hey|yo|kumusta|musta|good (morning|afternoon|evening))\b/i.test(text)) return out('greet')
  if (/^\s*(thanks|thank you|ty|salamat|tnx)\b/i.test(text)) return out('thanks')
  if (/\b(syllabus|course outline)\b/i.test(text)) return { ...keep, text: 'Paste your syllabus and I\'ll pull out the deadlines for you to confirm.', action: { type: 'openSyllabus' } }
  if (/\b(how'?s my week|my week|what'?s (on|up|coming)|anong meron|schedule ko|show my week|what do i have)\b/i.test(text))
    return { ...keep, text: '', action: { type: 'summary' } }
  const en = text.match(/\b(focus|work|study) best (in the |at )?(morning|afternoon|evening|night)s?\b/i)
  if (en) {
    const v = (en[3] === 'night' ? 'evening' : en[3]) as 'morning' | 'afternoon' | 'evening'
    return out('energy', { action: { type: 'energy', value: v } }, { v })
  }

  // New task
  const k = taskKind(text)
  if (k) {
    const w = parseWhen(text, now)
    const d: Draft = { title: extractTitle(text, k === 'exam' ? 'Exam' : 'Assignment'), kind: k, due: w?.t, hours: parseHours(text) ?? undefined }
    return next(d)
  }

  if (OFFTOPIC.test(text)) return out('offtopic', { rule: 'Scope filter: off-topic' })
  return out('unknown', { chips: ['Bio exam Friday', 'Shift Sat 2-8pm', "How's my week?"] })

  function next(d: Draft, prefix = ''): Turn {
    if (!d.due) return { draft: d, awaiting: 'due', text: prefix + say(pal, 'askDue') }
    if (!d.hours) return { draft: d, awaiting: 'hours', text: prefix + say(pal, d.kind === 'exam' ? 'askHoursExam' : 'askHours'), chips: ['2 hours', '4 hours', 'Not sure'] }
    return { draft: d, awaiting: 'confirm', text: prefix + say(pal, 'readback'), card: { type: 'readback', draft: d } }
  }
}

export function describeDraft(d: Draft) {
  return [d.title, d.due ? `${d.kind === 'exam' ? 'on' : 'due'} ${fmtDay(d.due)}${new Date(d.due).getHours() === 23 ? '' : ' ' + fmtTime(d.due)}` : '', d.hours ? fmtHours(d.hours) : '']
}
