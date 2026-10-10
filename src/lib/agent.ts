// Pal's brain: scope filter → intent → slot-filling dialog. Deterministic and auditable.
import { fmtDay, fmtHours, fmtTime, HOUR, type PalId, type PalState, type TaskKind } from './core'
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
/** The event card still waiting for Add it / Never mind, so "no, it's a lunch date" can revise it. */
export interface LastEvent { title: string; kind: string; start: number; end: number; days?: number[] }

export type Card =
  | { type: 'readback'; draft: Draft }
  | { type: 'proposal'; taskId: string; blockIds: string[]; why: string; shortfall: number; freeHours: number; commute?: boolean }
  | { type: 'checkin'; eventIds: string[] }
  | { type: 'event'; title: string; kind: string; start: number; end: number; conflicts: number; whatIf?: boolean; days?: number[] }
  | { type: 'notify' }
  | { type: 'boundary' }

export type Action =
  | { type: 'confirmDraft'; draft: Draft }
  | { type: 'addEvent'; title: string; kind: string; start: number; end: number; whatIf: boolean; days?: number[] }
  | { type: 'summary' }
  | { type: 'weather' }
  | { type: 'pref'; latestHour?: number; blockedDays?: number[]; clear?: boolean }
  | { type: 'freeTime'; day: number }
  | { type: 'energy'; value: 'morning' | 'afternoon' | 'evening' }
  | { type: 'openSyllabus' }
  | { type: 'reviseEvent'; title: string; kind: string; start: number; end: number; days?: number[] }

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
  revised: ['Ahh got it. Like this?', 'Oops, fixed it. This one?'],
  reflowNone: ["Nothing left to move. You're good on this one."],
  graded: ["I can't write it for you, but I can save you some focus time for it. How long do you think you need?"],
  grades: ["I honestly can't tell you your grade. I can show how much study time fits before the exam though."],
  stress: ["I can't really tell how you're feeling, but I can look at your week and see what we can move. And if it's getting heavy, the guidance office is there for you."],
  inject: ["Let's stick to your schedule. Anything else coming up?"],
  offtopic: [
    "Ooh, I get what you're asking, but that's outside what I can help with. Want to look at {next} instead?",
    "That one's not really my thing, sorry! I'm better at time stuff. Should we plan around {next}?",
    "I'd love to, but I'm just your planning buddy. How about we block some time for {next}?",
    "Hmm, can't help with that one. What I can do is make your week lighter. Start with {next}?",
  ],
  time: ["It's {t}, {d}.", '{t} right now, {d}.'],
  prefSaved: ["Noted! I'll remember: {what}.", 'Got it, {what}. I\'ll plan around that from now on.'],
  prefCleared: ['Okay, I forgot your planning preferences. Fresh start!'],
  focusStart: ["Focus time! I'll stay right here.", "Okay, 25 minutes. You've got this."],
  breakStart: ['Nice round! Take 5, stretch and drink water.', 'Break time. Look away from the screen for a bit.'],
  longBreak: ['Four rounds done! Take a longer 15-minute break.'],
  sessionDone: ['Session saved. {m} min focused today.'],
  setDone: ["Set complete, four rounds done! Start another whenever you're ready."],
  weatherNone: ["I can't check the weather right now, sorry! Once you're online I'll grab it.", 'No weather info yet, I need internet for that. Try again in a bit?'],
  thanks: ['Anytime!', 'Of course :)'],
  chatHow: ["Doing good, thanks for asking! How's your week going?", 'All good here! Anything coming up for you?'],
  chatWho: ["I'm your planning buddy. Tell me your classes, deadlines or shifts and I'll fit them into your week.", 'I help you plan your week. Try "Bio exam Friday" or "gym tomorrow 5pm".'],
  chatAck: ['Okay! Just tell me whenever something comes up.', "Sige! I'm here if you need to plan something."],
  chatHuh: ['Oops, was I unclear? I can add things to your week, like "study tomorrow 3pm" or "Math quiz Friday".', "Hmm, sorry! Ask me to add a class, shift or deadline and I'll handle it."],
  unknown: [
    'Hmm, not sure I caught that. If it\'s about your schedule, try "Bio exam Friday" or "gym tomorrow 5pm". Or should we look at {next}?',
    "I might've missed that one! I'm best with plans and deadlines. Want to check {next}?",
    "Sorry, I didn't quite get it. Tell me what's coming up and I'll fit it in.",
  ],
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
    offtopic: ["I hear you, but that's not something I can help with. Maybe we take a gentle look at {next}?"],
  },
  diel: {
    greet: ["Hey, Diel here. Give me your classes, deadlines, shifts. I like a good schedule."],
    askHours: ['How many hours, roughly?', "What's your estimate in hours?"],
    accepted: ["In the calendar. I'll check in after each block."],
    doneOk: ['Done. Love a clean list.'],
    offtopic: ['Outside my parameters, unfortunately. Within them: {next}. Want me to plan it?'],
  },
  jhyvie: {
    greet: ['Hiii, Jhyvie here! Kwento mo naman your week, classes, deadlines, raket, lahat.'],
    askDue: ['Sige! Kailan deadline?', 'Okay! When is it due?'],
    askHours: ['Mga ilang oras kaya yan?', 'How many hours you think?'],
    accepted: ["G! Nasa calendar na. Kamustahin kita after each block ha."],
    doneOk: ['Yay, tapos na yan!', 'Galing! Done!'],
    notNow: ['Sige, later na lang. Sabihin mo lang "plan it".'],
    offtopic: ['Gets ko yan, pero hindi ko talaga forte yan hehe. Tara, {next} na lang natin pag-usapan?', 'Ay, di ko kaya sagutin yan! Pero kaya kitang tulungan sa {next}, game?'],
    time: ['{t} na! {d} ngayon.'],
    focusStart: ['Tara, focus muna! Nandito lang ako.'],
    breakStart: ['Galing! Break muna, 5 minutes. Inom ka tubig!'],
  },
  jaypee: {
    greet: ["Yo, Jaypee here! What's the week look like?"],
    askDue: ['When is it due?', 'Deadline?'],
    askHours: ['How many hours?'],
    accepted: ["Locked in! Let's go."],
    doneOk: ["Let's gooo, done!", 'Boom. Checked off.'],
    offtopic: ["Ha, not my sport! What I CAN coach is your week. Let's lock in {next}?"],
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
export function turn(input: string, ctx: { pal: PalId; now: number; draft: Draft | null; awaiting: Awaiting; pending?: PendingEvent | null; lastEvent?: LastEvent | null; facts?: { next: string } }): Turn {
  const { pal, now } = ctx
  const text = input.trim()
  const keep = { draft: ctx.draft, awaiting: ctx.awaiting }
  const F = { next: ctx.facts?.next ?? 'your week' }
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

  // Correcting the event card still waiting: "no, it's a lunch date", "make it 3pm", "call it Gym"
  // Standing preferences: "I don't study after 9pm", "keep Sundays free", "forget my preferences"
  if (/\b(forget|reset|clear)\b.*\b(pref(erence)?s?|rules?)\b/i.test(text)) return out('prefCleared', { action: { type: 'pref', clear: true } })
  const negates = /\b(don'?t|do not|never|no|ayoko(ng)?|wag|huwag|walang)\b/i.test(text)
  const late = negates && /\b(study|studying|aral|mag-?aral|work|plan|schedule|sched|anything|review)\b/i.test(text)
    ? text.match(/\b(?:after|past|lampas(?: ng)?|beyond)\s+(\d{1,2})(?::00)?\s*(am|pm)?/i) : null
  // A time range means a real event ("keep friday free for my class 9-12"), not a rest day
  const restDays = !parseRange(text, now) && (negates || /\b(keep|leave|rest day|day off)\b/i.test(text)) && /\b(free|rest|off|plans?|study|schedule|sched|anything)\b/i.test(text)
    ? parseDays(`every ${text}`) : null
  if (late || restDays) {
    const h = late ? +late[1] : NaN
    const latestHour = late ? (/am/i.test(late[2] ?? '') ? h % 12 : h < 12 ? h + 12 : h) : undefined
    const names = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
    const what = [latestHour != null ? `nothing after ${fmtTime(new Date(now).setHours(latestHour, 0, 0, 0))}` : '', restDays ? `${restDays.map((d) => names[d]).join(' and ')} stay free` : ''].filter(Boolean).join(', ')
    return out('prefSaved', { action: { type: 'pref', latestHour, blockedDays: restDays ?? undefined } }, { what })
  }

  // Today questions: answered from the clock / cached weather, never guessed
  const day = (o: Intl.DateTimeFormatOptions) => new Date(now).toLocaleDateString('en-US', { weekday: 'long', ...o })
  if (/\b(what time is it|what'?s the time|time check|anong oras na|anong oras ngayon|oras na ba)\b/i.test(text) || /^\s*(what time|time|oras)\W*$/i.test(text))
    return out('time', {}, { t: fmtTime(now), d: day({ month: 'short', day: 'numeric' }) })
  if (/\b(what day is (it|today)|what'?s the date|anong araw (na|ngayon)|anong petsa|what'?s today)\b/i.test(text))
    return out('time', {}, { t: fmtTime(now), d: day({ month: 'long', day: 'numeric' }) })
  if (/\b(weather|panahon|forecast|temperature|uulan|maulan|will it rain|is it raining|umuulan)\b/i.test(text)) return { ...keep, text: '', action: { type: 'weather' } }
  if (/\b(am i free|free (ba )?ako|free time|bakante|when am i free|kailan ako free)\b/i.test(text)) {
    const w = hasSingleDay(text, now) ? parseWhen(text, now) : null
    return { ...keep, text: '', action: { type: 'freeTime', day: w ? w.t : now } }
  }

  const fix = ctx.lastEvent && text.match(/^\s*(?:no+|nope|hindi|mali|wait|actually|ay)?[\s,.!]*(?:it'?s|its|it is|make it|call it|change (?:it )?to|rename (?:it )?to|dapat|gawin mong)\s+(?:an?\s+|the\s+)?(.+)$/i)
  if (ctx.lastEvent && fix) {
    const le = ctx.lastEvent
    const w = parseWhen(fix[1], now)
    const start = w?.hadTime ? w.t : le.start
    const title = extractTitle(fix[1], le.title)
    return { ...keep, text: say(pal, 'revised'), action: { type: 'reviseEvent', title, kind: eventKind(fix[1]) ?? le.kind, start, end: start + (le.end - le.start), days: le.days } }
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

  // Single time event (e.g. "gym at 5pm", "lagay mo bukas 3pm study", "review tomorrow 2pm")
  const singleWhen = parseWhen(text, now)
  if (singleWhen?.hadTime && (ek || /\b(gym|workout|study|review|shift|class|duty|meeting|org|training|practice|lagay|schedule|add|put|set)\b/i.test(text))) {
    const kind = ek ?? (/\b(gym|workout|run|training)\b/i.test(text) ? 'protected' : 'work')
    const title = extractTitle(text.replace(/\b(lagay( mo)?|schedule|add|put|set)\b/gi, ''), kind === 'protected' ? 'Gym' : kind === 'class' ? 'Class' : kind === 'shift' ? 'Shift' : 'Study Session')
    const start = singleWhen.t
    const end = start + 1 * HOUR
    return { ...keep, pending: null, text: '', action: { type: 'addEvent', title, kind, start, end, whatIf: false } }
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

  if (/^\s*(hi|hello|hey|yo|kumusta|musta|good (morning|afternoon|evening))\b/i.test(text) && text.split(/\s+/).length <= 3) return out('greet') // "hey add plan at 5" falls through
  if (/^\s*(thanks|thank you|ty|salamat|tnx)\b/i.test(text)) return out('thanks')
  if (/\b(how are you|how r u|how'?s it going|kumusta ka|musta ka|kamusta ka)\b/i.test(text)) return out('chatHow')
  if (/\b(who are you|what are you|what can you do|sino ka|anong kaya mo)\b/i.test(text)) return out('chatWho')
  if (/^\s*(what|huh|ha|ano|eh)\W*$/i.test(text)) return out('chatHuh')
  if (/^\s*(ok|okay|sige|ayun|ayos|lol|haha+|hehe+|nice|cool|g|sure|alright|i see)\W*$/i.test(text)) return out('chatAck')
  if (/\b(syllabus|course outline)\b/i.test(text)) return { ...keep, text: 'Paste your syllabus and I\'ll pull out the deadlines for you to confirm.', action: { type: 'openSyllabus' } }
  if (/\b(how'?s my week|my week|how busy|analy[sz]e|workload|kaya ko ba|what'?s (on|up|coming)|anong meron|schedule ko|show my week|what do i have)\b/i.test(text))
    return { ...keep, text: '', action: { type: 'summary' } }
  const en = text.match(/\b(focus|work|study) best (in the |at )?(morning|afternoon|evening|night)s?\b/i)
  if (en) {
    const v = (en[3] === 'night' ? 'evening' : en[3]) as 'morning' | 'afternoon' | 'evening'
    return out('energy', { action: { type: 'energy', value: v } }, { v })
  }

  // "who won the nba finals" is trivia, not a finals exam: off-topic questions that aren't about *their* stuff
  if (OFFTOPIC.test(text) && !/\b(my|me|i|ko|ako|deadline|due|sched(ule)?|plan|free|busy)\b/i.test(text)) return out('offtopic', { rule: 'Scope filter: off-topic' }, F)

  // New task
  const k = taskKind(text)
  if (k) {
    const w = parseWhen(text, now)
    const d: Draft = { title: extractTitle(text, k === 'exam' ? 'Exam' : 'Assignment'), kind: k, due: w?.t, hours: parseHours(text) ?? undefined }
    return next(d)
  }

  if (OFFTOPIC.test(text)) return out('offtopic', { rule: 'Scope filter: off-topic' }, F)
  return out('unknown', {}, F)

  function next(d: Draft, prefix = ''): Turn {
    if (!d.due) return { draft: d, awaiting: 'due', text: prefix + say(pal, 'askDue') }
    if (!d.hours) return { draft: d, awaiting: 'hours', text: prefix + say(pal, d.kind === 'exam' ? 'askHoursExam' : 'askHours'), chips: ['2 hours', '4 hours', 'Not sure'] }
    return { draft: d, awaiting: 'confirm', text: prefix + say(pal, 'readback'), card: { type: 'readback', draft: d } }
  }
}

export function describeDraft(d: Draft) {
  return [d.title, d.due ? `${d.kind === 'exam' ? 'on' : 'due'} ${fmtDay(d.due)}${new Date(d.due).getHours() === 23 ? '' : ' ' + fmtTime(d.due)}` : '', d.hours ? fmtHours(d.hours) : '']
}
