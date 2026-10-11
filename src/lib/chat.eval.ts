// Conversation eval: the "training data" for Pal. Tweak prompts / rules until this passes.
// Run: pnpm eval:chat            (rules engine only, offline)
//      GROQ_API_KEY=gsk_... pnpm eval:chat --llm   (also scores the online model; spends that key's daily quota)
//      pnpm eval:chat --local [model]              (scores your Ollama model instead: free, no limits)
import { greetLine, turn, type Card, type LastEvent } from './agent'
import { buildContext, type OpenCard } from './context'
import { at, fmtTime, seedWeek, uid, type CalEvent, type PalId } from './core'
import { aiFailure, alignToMessage, askGroq, cloudTokensUsed, generateSystemPrompt, isGroundedEvent, normalizeOllamaUrl, parrots, parseRateLimit, readHint, recoverEvent, sanitizeAi, useLocalAiForEval, type AiAction, type ChatTurn } from './groq'
import { eventKind, extractTitle, parseWhen } from './parse'
import { clashes, nearestFree, occurrences, propose } from './schedule'

type Check = { action?: string | string[]; notAction?: string; includes?: string[]; excludes?: string[]; anyOf?: string[]; has?: (keyof AiAction)[] }
export interface Case {
  input: string
  expect: Check
  lastEvent?: LastEvent
  history?: ChatTurn[]
  note?: string
  /** The card a typed yes/no answers, and whether Pal said anything after it */
  waiting?: Card['type']
  latest?: boolean
  /** LLM cases: the waiting card as the model sees it, and extra calendar events */
  open?: (now: number) => OpenCard
  setup?: (now: number) => CalEvent[]
  /** LLM cases: a fixed clock instead of the eval's Wednesday (the transcript happened on a Sunday) */
  clock?: number
  /** LLM cases: what the user asked to be called */
  user?: string
}

const NO_DODGE = ["didn't get", 'lost me', "don't understand", 'not sure what you mean']

// A card still waiting for the user's answer, and the turn that proposed it
const SIMBA: LastEvent = { title: 'Simba', kind: 'protected', start: 0, end: 3_600_000 }
const MATH: LastEvent = { title: 'Math', kind: 'class', start: 0, end: 2 * 3_600_000 }
const ASKED: ChatTurn[] = [
  { role: 'user', content: 'simba bukas 9 to 10am' },
  { role: 'assistant', content: 'Simba tomorrow, 9 to 10am. Want me to add it?' },
]

/** Deterministic rules engine: must pass 100%. `{now}` in includes is replaced with the clock. */
export const RULE_CASES: Case[] = [
  { input: 'hi bosing', expect: { includes: ['Jhyvie'] } },
  { input: 'how are you', expect: { excludes: NO_DODGE } },
  { input: 'what time is it', expect: { includes: ['{now}'] } },
  { input: 'anong oras na', expect: { includes: ['{now}'] } },
  { input: "what's the weather later", expect: { action: 'weather' } },
  { input: 'uulan ba mamaya?', expect: { action: 'weather' } },
  { input: 'am i free tomorrow', expect: { action: 'freeTime' } },
  { input: "how's my week", expect: { action: 'summary' } },
  { input: 'who won the nba finals', expect: { excludes: NO_DODGE, includes: ['Rizal'] }, note: 'redirect mentions the real next deadline' },
  { input: 'write my essay for me', expect: { includes: ["can't write it"] } },
  { input: 'lunch date in 2 hours', expect: { action: 'addEvent' } },
  { input: 'hey add plan 1 hour after', expect: { action: 'addEvent' } },
  { input: 'gym tomorrow 6pm', expect: { action: 'addEvent' } },
  { input: 'may pasok ako 7am', expect: { action: 'addEvent' }, note: '"pasok" is going to class' },
  { input: 'lunch with iska mga 30mins mula ngayon', expect: { action: 'addEvent' }, note: '"mula ngayon" is "from now"' },
  { input: 'no, its a lunch date', lastEvent: { title: 'Study Session', kind: 'work', start: 0, end: 3_600_000 }, expect: { action: 'reviseEvent', includes: [] } },
  { input: 'Bio quiz friday', expect: { excludes: NO_DODGE } },
  { input: "I don't study after 9pm", expect: { action: 'pref', includes: ['9pm'] } },
  { input: 'ayoko mag-aral lampas 10', expect: { action: 'pref', includes: ['10pm'] } },
  { input: 'keep sundays free please', expect: { action: 'pref', includes: ['Sundays'] } },
  { input: 'forget my preferences', expect: { action: 'pref' } },
  { input: 'keep friday free for my class 9-12', expect: { action: 'addEvent' }, note: 'a time range means a real event, not a rest-day preference' },
  // Safety net for answering the waiting card when no model answers
  { input: 'tama', lastEvent: SIMBA, expect: { action: 'confirmEvent' } },
  { input: 'okkkk', lastEvent: SIMBA, expect: { action: 'confirmEvent' } },
  { input: 'sge', lastEvent: SIMBA, expect: { action: 'confirmEvent' } },
  { input: 'sige ilagay mo na', lastEvent: SIMBA, expect: { action: 'confirmEvent' } },
  { input: 'wag na', lastEvent: SIMBA, expect: { action: 'skipEvent' } },
  { input: 'yes but make it 3pm', lastEvent: SIMBA, expect: { notAction: 'confirmEvent' }, note: 'a change is not a yes' },
  { input: 'make it 10 to 11 instead', lastEvent: SIMBA, expect: { action: 'reviseEvent' }, note: 'the app revises the card even when the model only talks' },
  { input: 'ok', expect: { notAction: 'confirmEvent' }, note: 'nothing waiting, nothing to confirm' },
  // The transcript: typed answers to a study-plan card
  { input: 'okay', waiting: 'proposal', latest: true, expect: { action: 'confirmEvent' }, note: '"okay" to the plan card accepts it' },
  { input: 'not now', waiting: 'proposal', latest: true, expect: { action: 'skipEvent' } },
  { input: 'oo', waiting: 'readback', latest: true, expect: { action: 'confirmEvent' } },
  // "oo ikaw na bahala" after Pal asked about something else: show the Math card again, don't add it blind
  { input: 'oo ikaw na bahala', lastEvent: MATH, waiting: 'event', latest: false, expect: { notAction: 'confirmEvent', action: 'addEvent' } },
  { input: 'oo', lastEvent: MATH, waiting: 'event', latest: true, expect: { action: 'confirmEvent' } },
]

// Fixed clock for the grounding cases: Sat Oct 10 2026, 10pm; "bukas 9am" is Sun 9am
const NOW = new Date(2026, 9, 10, 22, 0).getTime()
const T9 = new Date(2026, 9, 11, 9, 0).getTime()
// The transcript's clock: Sun Oct 11 2026, 2:45pm
const SUN = new Date(2026, 9, 11, 14, 45).getTime()
const iso = (t: number) => { const d = new Date(t), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00` }
// The overlap and local-model screenshots: Mon Oct 12 and Tue Oct 13
const MON = new Date(2026, 9, 12).getTime()
const TUE = new Date(2026, 9, 13).getTime()
const TRAVEL: CalEvent = { id: 'tr', title: 'Travel to school', kind: 'commute', start: at(MON, 4), end: at(MON, 5), status: 'planned' }
const STUDY_BLOCK: CalEvent = { id: 'sb', title: 'Review: Prelims', kind: 'work', start: at(MON, 9), end: at(MON, 10), status: 'planned', taskId: 't' }
/** The card the local model kept putting on tomorrow: Meeting Tue 10am–1pm */
const MEET: LastEvent = { title: 'Meeting', kind: 'work', start: at(TUE, 10), end: at(TUE, 13) }
const fixCard = (text: string, card: Partial<LastEvent> = {}) => {
  const a = turn(text, { pal: 'jhyvie', now: at(MON, 9), draft: null, awaiting: null, lastEvent: { ...MEET, ...card }, waiting: 'event' }).action
  return a?.type === 'reviseEvent' ? a : null
}

/** sanitizeAi and the parsers behind it: the guard between the model and the calendar. Must pass 100%. */
export const SANITIZE_CASES: { name: string; ok: () => boolean }[] = [
  { name: 'confirmEvent with no card waiting → none', ok: () => sanitizeAi({ text: 'Added!', action: { type: 'confirmEvent' } }, 'add it', 0, false)?.action?.type === 'none' },
  { name: 'confirmEvent with a card waiting is kept', ok: () => sanitizeAi({ text: 'Sige, adding it!', action: { type: 'confirmEvent' } }, 'push mo na', 0, true)?.action?.type === 'confirmEvent' },
  { name: 'skipEvent with no card waiting → none', ok: () => sanitizeAi({ text: 'Okay!', action: { type: 'skipEvent' } }, 'wag na', 0, false)?.action?.type === 'none' },
  { name: '"Done! Added" with no write is flagged', ok: () => sanitizeAi({ text: "Done! Added your simba for tomorrow.", action: { type: 'none' } }, 'tama', 0, true)?.claimed === 'add' },
  { name: '"I\'ve locked in" with no write is flagged', ok: () => sanitizeAi({ text: "I've locked in your simba!", action: { type: 'none' } }, 'simba 9am', 0, false)?.claimed === 'add' },
  { name: '"Want me to lock it in?" is a question, not a claim', ok: () => !sanitizeAi({ text: 'Moving it to 10-11am. Want me to lock it in?', action: { type: 'none' } }, 'hi', 0, false)?.claimed },
  { name: 'a plain question is not flagged', ok: () => !sanitizeAi({ text: 'Simba tomorrow 9-10am, want me to add it?', action: { type: 'none' } }, 'hi', 0, false)?.claimed },
  // Re-proposals grounded in an earlier message ("asan na" after "simba bukas 9 to 10am")
  { name: 'addEvent grounded in a recent user message is kept', ok: () => sanitizeAi({ text: 'Simba bukas 9-10am, tama ba?', action: { type: 'addEvent', title: 'Simba', start: '2026-10-11T09:00:00', end: '2026-10-11T10:00:00' } }, 'asan na', 0, false, 'simba bukas 9 to 10am')?.action?.type === 'addEvent' },
  { name: 'addEvent with no time anywhere → none', ok: () => sanitizeAi({ text: 'Gym?', action: { type: 'addEvent', title: 'Gym', start: '2026-10-11T09:00:00' } }, 'hi', 0, false, 'hello there')?.action?.type === 'none' },
  { name: 'yes to a cardless proposal becomes a card', ok: () => sanitizeAi({ text: 'Sige!', action: { type: 'confirmEvent', title: 'Simba', kind: 'protected', start: '2026-10-11T09:00:00', end: '2026-10-11T10:00:00' } }, 'oo', 0, false, 'simba bukas 9 to 10am')?.action?.type === 'addEvent' },
  {
    name: 'yes with no card and no details → none + claimed',
    ok: () => { const r = sanitizeAi({ text: 'Adding it now!', action: { type: 'confirmEvent' } }, 'oo', 0, false, ''); return r?.action?.type === 'none' && r.claimed === 'add' },
  },
  { name: '"Adding Simba now" with no write is flagged', ok: () => sanitizeAi({ text: 'Got it! Adding Simba now.', action: { type: 'none' } }, 'oo', 0, false)?.claimed === 'add' },
  { name: '"Let me lock it in again" with no write is flagged', ok: () => sanitizeAi({ text: 'Let me lock it in again: Simba bukas 9am.', action: { type: 'none' } }, 'asan na', 0, false)?.claimed === 'add' },
  {
    name: 'ISO timestamps become human times',
    ok: () => { const t = sanitizeAi({ text: 'Adding Simba from 2026-10-11T09:00:00 to 2026-10-11T10:00:00.', action: { type: 'none' } }, 'hi', 0, false)?.text ?? ''; return !/\d{4}-\d{2}-\d{2}T/.test(t) && t.includes('9am') && t.includes('10am') },
  },
  { name: '"Sige, i-lock ko na!" with no write is flagged', ok: () => sanitizeAi({ text: 'Sige, i-lock ko na! Simba bukas 9-11am.', action: { type: 'none' } }, 'wala na', 0, false)?.claimed === 'add' },
  { name: '"i-add ko na ba?" is a question, not a claim', ok: () => !sanitizeAi({ text: 'Simba 9am. Sige, i-add ko na ba?', action: { type: 'none' } }, '9am', 0, false)?.claimed },
  // A recovered event only counts if its time is in text the user actually saw
  { name: 'recovered event grounded in the chat is accepted', ok: () => isGroundedEvent({ type: 'addEvent', title: 'Simba', start: iso(T9), end: iso(T9 + 2 * 3_600_000) }, ['Ayan! Bukas 9-11am ang Simba.'], NOW) },
  { name: 'recovered event at a time nobody said is rejected', ok: () => !isGroundedEvent({ type: 'addEvent', title: 'Simba', start: iso(T9 + 3_600_000), end: iso(T9 + 2 * 3_600_000) }, ['Ayan! Bukas 9-11am ang Simba.'], NOW) },
  { name: 'recovered event with no title is rejected', ok: () => !isGroundedEvent({ type: 'addEvent', start: iso(T9), end: iso(T9 + 3_600_000) }, ['Bukas 9-10am.'], NOW) },
  {
    name: '[Proposed event …] and \\n are stripped',
    ok: () => sanitizeAi({ text: 'Got it, 9 to 10am! [Proposed event: Simba, Sun, Oct 11 9am-10am]\\n', action: { type: 'none' } }, 'hi', 0, false)?.text === 'Got it, 9 to 10am!',
  },
  // The transcript: deletes it couldn't do, claims it didn't do, and in-scope asks tagged off-topic
  { name: '"tinanggal ko na" with no removeEvent is a remove claim', ok: () => sanitizeAi({ text: "Sige, tinanggal ko na 'yan.", action: { type: 'none' } }, 'delete mo', SUN, false)?.claimed === 'remove' },
  {
    name: '"I\'ll leave it off" with nothing waiting is a remove claim',
    ok: () => { const r = sanitizeAi({ text: "Okay, I'll leave it off.", action: { type: 'skipEvent' } }, 'delete mo pala yan', SUN, false); return r?.action?.type === 'none' && r.claimed === 'remove' },
  },
  { name: '"naka-lock na" with no write is flagged', ok: () => sanitizeAi({ text: 'Ayan, naka-lock na yung Math class mo bukas 7-9am!', action: { type: 'none' } }, 'math bukas 7am to 9am', SUN, false)?.claimed === 'add' },
  { name: 'addEvent on a bare day with a made-up hour → none', ok: () => sanitizeAi({ text: 'Sabado, 3pm-4pm. Tama ba?', action: { type: 'addEvent', title: 'Prelims', start: '2026-10-17T15:00:00', end: '2026-10-17T16:00:00' } }, 'sabado na prelims ko', SUN, false)?.action?.type === 'none' },
  { name: '"nalista ko na" with no write is flagged', ok: () => sanitizeAi({ text: 'Ayan, nalista ko na! Sabado 3pm.', action: { type: 'none' } }, 'sabado na prelims ko', SUN, false)?.claimed === 'add' },
  { name: 'createTask on "4hrs" right after "sabado na prelims ko" is kept', ok: () => sanitizeAi({ text: 'Sige!', action: { type: 'createTask', title: 'Prelims', kind: 'exam', due: '2026-10-17T23:59:00', hours: 4 } }, '4hrs', SUN, false, 'sabado na prelims ko')?.action?.type === 'createTask' },
  { name: 'findTime on "4hrs" right after "sabado na prelims ko" is kept', ok: () => sanitizeAi({ text: 'Hanapan kita ng 4 hours!', action: { type: 'findTime', title: 'Prelims review', hours: 4, due: '2026-10-17T00:00:00' } }, '4hrs', SUN, false, 'sabado na prelims ko')?.action?.type === 'findTime' },
  { name: 'findTime on small talk → none', ok: () => sanitizeAi({ text: 'Sure!', action: { type: 'findTime', title: 'Study', hours: 2 } }, 'haha nice', SUN, false, 'hi kumusta')?.action?.type === 'none' },
  { name: 'an echoed [App note …] is stripped', ok: () => sanitizeAi({ text: 'Sabado pala! [App note: today is Sun, Oct 11.]', action: { type: 'none' } }, 'hi', SUN, false)?.text === 'Sabado pala!' },
  { name: '"I\'m removing that date" with no removeEvent is a remove claim', ok: () => sanitizeAi({ text: "Got it, I'm removing that date from your schedule!", action: { type: 'none' } }, 'delete mo pala yan', SUN, false)?.claimed === 'remove' },
  { name: '"Got it! Cancelling Simba" with nothing waiting is a remove claim', ok: () => sanitizeAi({ text: 'Got it! Cancelling Simba tomorrow 9-10am.', action: { type: 'none' } }, 'cancel that', SUN, false)?.claimed === 'remove' },
  { name: '"wala na yung date" with a Remove card still gets an honest line', ok: () => sanitizeAi({ text: 'Oo nga, wala na yung date with iska.', action: { type: 'removeEvent', id: 'e1' } }, 'delete mo pala yan', SUN, false, '', { e1: 'x' })?.claimed === 'remove' },
  { name: '"wala na" as "nothing else" is not a claim', ok: () => !sanitizeAi({ text: 'Sige, wala na akong idadagdag. May iba pa?', action: { type: 'none' } }, 'wala na', SUN, false)?.claimed },
  // The Oct 11 night transcript: "nag-add na ako" on a card that wasn't added yet
  { name: '"Sige, nag-add na ako ng event" with no write is a claim', ok: () => sanitizeAi({ text: 'Sige, nag-add na ako ng event bukas 4am (1h) para sa biyahe papunta sa school.', action: { type: 'addEvent', title: 'Travel to school', start: '2026-10-12T04:00:00', end: '2026-10-12T05:00:00' } }, 'add mo schedule ko tomorow ng 4am', SUN, false)?.claimed === 'add' },
  { name: '"Nag-add na ako?" is a question, not a claim', ok: () => !sanitizeAi({ text: 'Bukas 4am yung biyahe. Nag-add na ba ako?', action: { type: 'none' } }, 'hi', SUN, false)?.claimed },
  { name: '"Ayan, na-confirm na!" with a real yes is not a claim', ok: () => !sanitizeAi({ text: 'Ayan, na-confirm na!', action: { type: 'confirmEvent' } }, 'oo', SUN, true)?.claimed },
  { name: '"tomorow 4am" (typo) is tomorrow 4am', ok: () => parseWhen('add mo schedule ko tomorow ng 4am', SUN)?.t === new Date(2026, 9, 12, 4).getTime() },
  { name: 'their name is in the facts and the prompt guard still holds', ok: () => { const f = buildContext(SUN, [], [], null, {}, { user: 'Gadiel' }); return f.full.includes('The user is Gadiel') && generateSystemPrompt('jhyvie', SUN, f.full).length < 5000 } },
  { name: 'no name set → no name line', ok: () => !buildContext(SUN, [], [], null).full.includes('The user is') },
  { name: 'greeting uses their name, never a raw {user}', ok: () => greetLine('jhyvie', 'Gadiel').includes('Gadiel') && !greetLine('jhyvie').includes('{user}') && !greetLine('rei', '  ').includes('{user}') },
  { name: 'rules "hi" greets them by name', ok: () => turn('hi', { pal: 'jhyvie', now: SUN, draft: null, awaiting: null, facts: { next: 'your week', user: 'Gadiel' } }).text.includes('Gadiel') },
  { name: '"Tinatanggal ko na" with no write is a remove claim', ok: () => sanitizeAi({ text: 'Got it! Tinatanggal ko na yung date with Iska.', action: { type: 'none' } }, 'delete mo pala yan', SUN, false)?.claimed === 'remove' },
  { name: 'removeEvent with a listed id is kept', ok: () => sanitizeAi({ text: 'Eto yung date, tap Remove.', action: { type: 'removeEvent', id: 'e1' } }, 'delete mo pala yan', SUN, false, '', { e1: 'x' })?.action?.type === 'removeEvent' },
  { name: 'removeEvent with an unknown id → none', ok: () => sanitizeAi({ text: 'Removing it.', action: { type: 'removeEvent', id: 'e9' } }, 'delete mo', SUN, false, '', { e1: 'x' })?.action?.type === 'none' },
  { name: 'removeEvent card with "tinanggal ko na" still gets an honest line', ok: () => sanitizeAi({ text: 'Tinanggal ko na.', action: { type: 'removeEvent', id: 'e1' } }, 'delete mo', SUN, false, '', { e1: 'x' })?.claimed === 'remove' },
  { name: 'moveEvent needs a time the user said', ok: () => sanitizeAi({ text: 'Moving it.', action: { type: 'moveEvent', id: 'e1', start: '2026-10-12T15:00:00' } }, 'move mo yung gym', SUN, false, '', { e1: 'x' })?.action?.type === 'none' },
  { name: 'moveEvent to a time the user said is kept', ok: () => sanitizeAi({ text: 'Like this?', action: { type: 'moveEvent', id: 'e1', start: '2026-10-12T15:00:00' } }, 'move mo yung gym bukas 3pm', SUN, false, '', { e1: 'x' })?.action?.type === 'moveEvent' },
  { name: 'event ids never reach the text', ok: () => !/\be4\b/.test(sanitizeAi({ text: 'Eto yung gym (e4), tap Remove.', action: { type: 'none' } }, 'hi', SUN, false)?.text ?? 'e4') },
  { name: 'redirect on "delete mo" is not trusted', ok: () => sanitizeAi({ text: 'Hmm, outside my lane!', action: { type: 'redirect' } }, 'delete mo', SUN, false)?.action?.type === 'none' },
  { name: 'redirect on "8 sunjects" mid-planning is not trusted', ok: () => sanitizeAi({ text: '8 subjects? Seryoso!', action: { type: 'redirect' } }, '8 sunjects', SUN, false, 'plan mo pg aaral ko review')?.action?.type === 'none' },
  { name: 'redirect on "love meaning" stays', ok: () => sanitizeAi({ text: 'Deep! Not my lane though.', action: { type: 'redirect' } }, 'love meaning', SUN, false, 'oy ano pangalan mo tagalog')?.action?.type === 'redirect' },
  // Parsing the app hands the model, so it never does date math itself
  { name: '"30mins mula ngayon" starts 30 min from now', ok: () => parseWhen('mga 30mins mula ngayon', SUN)?.t === SUN + 30 * 60_000 },
  { name: '"pasok" is a class', ok: () => eventKind('may pasok ako 7am') === 'class' },
  { name: 'hint: "sabado na prelims ko" is Sat Oct 17, in 6 days', ok: () => { const h = readHint('sabado na prelims ko', SUN); return h.includes('Sat, Oct 17') && h.includes('in 6 days') } },
  { name: 'hint: "30mins mula ngayon" is a start time, not a length', ok: () => { const h = readHint('mga 30mins mula ngayon', SUN); return h.includes('3:15pm') && !h.includes('length') } },
  { name: 'hint: "everyday bago mag october 17" repeats daily until Oct 17', ok: () => { const h = readHint('bigyan moko ng study schedule everyday bago mag october 17', SUN); return h.includes('every day') && h.includes('Oct 17') } },
  { name: 'hint: nothing parsed → no hint', ok: () => readHint('hays', SUN) === '' },
  // Daily study before an exam: each day gets its share, with breaks, titled as review
  {
    name: 'perDay: 2h every day until Sat, as "Review: Prelims" with breaks',
    ok: () => {
      const due = at(new Date(2026, 9, 17).getTime(), 23, 59)
      const p = propose({ id: 't', title: 'Prelims', kind: 'exam', due, hours: 12, doneHours: 0 }, 12, [], SUN, 'afternoon', {}, 2)
      const byDay = new Map<number, number>()
      for (const b of p.blocks) byDay.set(new Date(b.start).getDate(), (byDay.get(new Date(b.start).getDate()) ?? 0) + (b.end - b.start) / 3_600_000)
      const gapsOk = p.blocks.every((b, i) => i === 0 || new Date(b.start).getDate() !== new Date(p.blocks[i - 1].start).getDate() || b.start - p.blocks[i - 1].end >= 15 * 60_000)
      return byDay.size >= 6 && [...byDay.values()].every((h) => h <= 2) && p.blocks.every((b) => b.title === 'Review: Prelims') && gapsOk
    },
  },
  {
    name: '4h on an open week: no "15m won\'t fit" warning',
    ok: () => {
      const due = at(new Date(2026, 9, 17).getTime(), 23, 59)
      const p = propose({ id: 't', title: 'Prelims Prep', kind: 'assignment', due, hours: 4, doneHours: 0 }, 4, [], new Date(2026, 9, 11, 22, 30).getTime())
      return p.shortfall === 0 && p.blocks.reduce((a, b) => a + (b.end - b.start) / 3_600_000, 0) >= 4
    },
  },
  // Cloud quota and your PC's AI
  {
    name: 'a "tokens per day" 429 is out-of-quota, with Groq\'s wait time',
    ok: () => { const r = parseRateLimit('Rate limit reached for model `openai/gpt-oss-20b` on tokens per day (TPD): Limit 200000, Used 198749, Requested 2477. Please try again in 8m49.632s. Need more tokens?'); return r.quota && Math.abs(r.waitMs - 529_632) < 2 },
  },
  { name: 'a "tokens per minute" 429 is a short wait, not out-of-quota', ok: () => { const r = parseRateLimit('Rate limit reached on tokens per minute (TPM): Limit 8000, Used 7000, Requested 2400. Please try again in 10.5s.'); return !r.quota && r.waitMs === 10_500 } },
  { name: '429 wait in hours and ms', ok: () => parseRateLimit('on requests per day (RPD). Please try again in 1h2m3s.').waitMs === 3_723_000 && parseRateLimit('Please try again in 350ms').waitMs === 350 },
  { name: 'old full-endpoint Ollama URLs become the server address', ok: () => normalizeOllamaUrl('http://localhost:11434/v1/chat/completions') === 'http://localhost:11434' && normalizeOllamaUrl(' http://192.168.1.5:11434/ ') === 'http://192.168.1.5:11434' },
  {
    // Every character is paid on every message (200k tokens/day per model): don't let the prompt creep back up
    name: 'system prompt with a full calendar and a waiting card stays under 5,000 chars',
    ok: () => {
      const ev: CalEvent[] = Array.from({ length: 12 }, (_, i) => ({ id: `x${i}`, title: ['Calc II', 'Bio 101', 'Café shift', 'Review: Prelims', 'Gym'][i % 5], kind: (['class', 'class', 'shift', 'work', 'protected'] as const)[i % 5], start: SUN + (i + 1) * 9 * 3_600_000, end: SUN + (i + 1) * 9 * 3_600_000 + 5_400_000, status: 'planned' }))
      const facts = buildContext(SUN, ev, [{ id: 't', title: 'Prelims', kind: 'exam', due: SUN + 6 * 86_400_000, hours: 4, doneHours: 0 }], null, {}, { card: { type: 'event', title: 'Math', start: SUN + 86_400_000, end: SUN + 93_600_000 }, cardIsLatest: true })
      return generateSystemPrompt('jhyvie', SUN, facts.full).length < 5000
    },
  },
  {
    name: 'repeats stop on their until day, not 8 weeks out',
    ok: () => { const mon9 = new Date(2026, 9, 12, 9).getTime(); return occurrences(mon9, mon9 + 3 * 3_600_000, [1, 2, 3, 4, 5, 6], SUN, new Date(2026, 9, 17).getTime()).length === 6 },
  },
  // Overlaps: "pede ba ako mag meeting ng 4:30 am mamaya?" with Travel to school 4–5am already there
  { name: '"4:30 am mamaya" is 4:30am, not "a m(inute) later"', ok: () => parseWhen('pede ba ako mag meeting ng 4:30 am mamaya?', at(MON, 1))?.t === at(MON, 4, 30) },
  { name: '"in an hour" is still an hour from now', ok: () => parseWhen('gym in an hour', at(MON, 9))?.t === at(MON, 10) },
  { name: '"pede ba ako mag meeting" is titled Meeting', ok: () => extractTitle('pede ba ako mag meeting ng 4:30 am mamaya?', 'Event') === 'Meeting' && extractTitle('mag-review bukas 3pm', 'X') === 'Mag-review' },
  {
    name: 'a 4:30am meeting clashes with a 4–5am commute',
    ok: () => { const hit = clashes([{ start: at(MON, 4, 30), end: at(MON, 5, 30) }], [TRAVEL, STUDY_BLOCK]); return hit.length === 1 && hit[0].id === 'tr' },
  },
  { name: 'nearest free time: 5:15am (15 min after the commute)', ok: () => nearestFree([{ start: at(MON, 4, 30), end: at(MON, 5, 30) }], [TRAVEL], at(MON, 1))?.start === at(MON, 5, 15) },
  { name: 'nearest free time is never before 5am', ok: () => nearestFree([{ start: at(MON, 5), end: at(MON, 6) }], [{ ...TRAVEL, kind: 'class', start: at(MON, 5), end: at(MON, 7) }], at(MON, 1))?.start === at(MON, 7) },
  { name: 'nearest free time is never in the past', ok: () => nearestFree([{ start: at(MON, 15, 30), end: at(MON, 16, 30) }], [{ ...TRAVEL, kind: 'class', start: at(MON, 15), end: at(MON, 17) }], at(MON, 15))?.start === at(MON, 17) },
  { name: 'deadlines and a task\'s study blocks are not clashes', ok: () => clashes([{ start: at(MON, 9), end: at(MON, 10) }], [STUDY_BLOCK, { ...TRAVEL, id: 'dl', kind: 'deadline', start: at(MON, 9, 30), end: at(MON, 9, 30) }]).length === 0 },
  // Day corrections to the waiting card are the rules' (a 4B model kept saying "bukas")
  { name: '"mamaya hindi bukas" moves the card to today, same time and length', ok: () => { const a = fixCard('mamaya hindi bukas'); return a?.start === at(MON, 10) && a.end === at(MON, 13) } },
  { name: '"today" moves the card to today', ok: () => fixCard('today')?.start === at(MON, 10) },
  { name: '"mamaya ngaaaa" moves the card to today', ok: () => fixCard('mamaya ngaaaa')?.start === at(MON, 10) },
  { name: '"sabing mamayang 10 am" is today 10am', ok: () => { const a = fixCard('sabing mamayang 10 am', { start: at(TUE, 9), end: at(TUE, 12) }); return a?.start === at(MON, 10) && a.end === at(MON, 13) } },
  { name: '"oo lagay mo para mamaya" is today', ok: () => fixCard('oo lagay mo para mamaya')?.start === at(MON, 10) },
  { name: '"bukas hindi mamaya" stays tomorrow', ok: () => fixCard('bukas hindi mamaya', { start: at(MON, 10), end: at(MON, 13) })?.start === at(TUE, 10) },
  { name: '"gym bukas 6pm" with a card waiting is a new event, not a fix', ok: () => turn('gym bukas 6pm', { pal: 'jhyvie', now: at(MON, 9), draft: null, awaiting: null, lastEvent: MEET, waiting: 'event' }).action?.type === 'addEvent' },
  // The app's reading of the message wins over the model's dates
  {
    name: 'model says tomorrow for "10am hanggang 1pm mamaya" → today 10am–1pm',
    ok: () => { const a = alignToMessage({ type: 'addEvent', title: 'Meeting', start: iso(at(TUE, 10)), end: iso(at(TUE, 11)) }, 'meeting 10am hanggang 1pm mamaya', at(MON, 9)); return a.start === iso(at(MON, 10)) && a.end === iso(at(MON, 13)) },
  },
  { name: '"6pm" answering a Saturday question keeps Saturday', ok: () => { const sat = at(new Date(2026, 9, 17).getTime(), 18); return alignToMessage({ type: 'addEvent', title: 'Gym', start: iso(sat), end: iso(sat + 3_600_000) }, '6pm', at(MON, 9)).start === iso(sat) } },
  { name: 'a bare "bukas" moves the model\'s time onto tomorrow', ok: () => alignToMessage({ type: 'addEvent', title: 'Gym', start: iso(at(MON, 15)), end: iso(at(MON, 16)) }, 'gym bukas', at(MON, 9)).start === iso(at(TUE, 15)) },
  { name: 'two days in one message: the model decides', ok: () => alignToMessage({ type: 'createTask', title: 'Prelims', due: iso(at(new Date(2026, 9, 17).getTime(), 23, 59)) }, 'prelims sabado, review bukas', at(MON, 9)).due === iso(at(new Date(2026, 9, 17).getTime(), 23, 59)) },
  // Claims and echoes from the local model chats
  { name: '"Gabi! Adding tomorrow\'s coffee date." is a claim', ok: () => sanitizeAi({ text: "Gabi! Adding tomorrow's coffee date.", action: { type: 'none' } }, 'coffee date bukas', SUN, false)?.claimed === 'add' },
  { name: '"Adding it to Monday?" is a question, not a claim', ok: () => !sanitizeAi({ text: 'Adding it to Monday?', action: { type: 'none' } }, 'hi', SUN, false)?.claimed },
  { name: '"tap addEvent" names the button, not the action', ok: () => sanitizeAi({ text: 'Sige, tap addEvent para organized!', action: { type: 'none' } }, 'hi', SUN, false)?.text === 'Sige, tap Add it para organized!' },
  { name: '"Wats your name, Jhy?" back to "wats your name" is dropped', ok: () => sanitizeAi({ text: 'Wats your name, Jhy?', action: { type: 'none' } }, 'wats your name', SUN, false) === null },
  { name: '"Hi Gadiel!" to "hi jv" is a real answer', ok: () => !parrots('Hi Gadiel! Kamusta?', 'hi jv') && parrots('Hi jv!', 'hi jv') },
  { name: 'the prompt says JV and Jhy are Jhyvie\'s names, not the user\'s', ok: () => /JV, Jhy/.test(generateSystemPrompt('jhyvie', SUN, '')) && /never the user's/.test(generateSystemPrompt('jhyvie', SUN, '')) },
]

/** Model behaviour: scored, not required to be perfect. Same calendar as the rules cases. */
export const LLM_CASES: Case[] = [
  // The local model called Gadiel "Jhy" (Jhyvie's own nickname)
  { input: 'kamusta ka jhy?', user: 'Gadiel', expect: { excludes: ['ka jhy', 'jhy!', 'jhy?', 'jhy,'] }, note: 'never calls the user Jhy' },
  { input: 'who won the nba finals?', expect: { action: 'redirect', excludes: NO_DODGE } },
  { input: 'can you explain photosynthesis', expect: { action: 'redirect', excludes: NO_DODGE } },
  { input: "what's 17 times 23", expect: { action: 'redirect', excludes: NO_DODGE } },
  { input: 'recommend me a netflix show', expect: { action: 'redirect', excludes: NO_DODGE } },
  { input: "i'm bored", expect: { action: ['none', 'redirect'], excludes: NO_DODGE } },
  { input: 'kumusta ka?', expect: { action: 'none' } },
  { input: 'good morning!', expect: { action: 'none' } },
  { input: "how's my week looking?", expect: { action: ['analyzeWeek', 'none'] } },
  { input: 'am i busy tomorrow?', expect: { action: ['analyzeWeek', 'none'] } },
  { input: 'find me 3 hours to review bio before friday', expect: { action: 'findTime' } },
  { input: 'gym tomorrow at 6pm', expect: { action: 'addEvent' } },
  { input: 'lagay mo bukas 3pm study', expect: { action: 'addEvent' } },
  { input: 'math exam next tuesday', expect: { action: ['createTask', 'addEvent', 'none'] } },
  { input: 'what time is it?', expect: { action: 'none', includes: ['{now}'] } },
  { input: 'hi', expect: { action: 'none' } },
  // Timer/reminder wording the rules don't catch: the model is the backup
  { input: 'can you count down ten minutes for my break', expect: { action: 'setTimer', has: ['seconds'] } },
  { input: 'pakisabihan mo ako mamayang 3pm na mag-review', expect: { action: 'setReminder', has: ['note'] } },
  { input: 'hi jv', user: 'Gadiel', expect: { action: 'none', excludes: ['hi jv', 'hi, jv', 'hey jv', 'uy jv', 'jv!'] }, note: 'jv is Jhyvie; the user is Gadiel' },
  // A card is waiting: the model reads intent in any wording, the app does the write
  { input: 'tama', lastEvent: SIMBA, history: ASKED, expect: { action: 'confirmEvent' } },
  { input: 'sige ilagay mo na', lastEvent: SIMBA, history: ASKED, expect: { action: 'confirmEvent' } },
  { input: 'lock it in', lastEvent: SIMBA, history: ASKED, expect: { action: 'confirmEvent' } },
  { input: 'push mo na', lastEvent: SIMBA, history: ASKED, expect: { action: 'confirmEvent' } },
  { input: "where's the button just add it", lastEvent: SIMBA, history: ASKED, expect: { action: 'confirmEvent' } },
  { input: 'okkkk', lastEvent: SIMBA, history: ASKED, expect: { action: 'confirmEvent' } },
  { input: 'wag na pala', lastEvent: SIMBA, history: ASKED, expect: { action: 'skipEvent' } },
  { input: 'cancel that', lastEvent: SIMBA, history: ASKED, expect: { action: 'skipEvent' } },
  { input: 'make it 10 to 11 instead', lastEvent: SIMBA, history: ASKED, expect: { action: 'addEvent' } },
  { input: 'ok add it', expect: { notAction: 'confirmEvent' }, note: 'nothing waiting, so nothing to confirm' },
  // The screenshot: Pal proposed in words, no card exists, user says "oo" → a working card, not a dead end
  {
    input: 'oo',
    history: [{ role: 'user', content: 'simba bukas 9 to 10am' }, { role: 'assistant', content: 'Simba bukas, 9am to 10am. Tama ba?' }],
    expect: { action: 'addEvent' },
  },
  // The Oct 11 transcript
  {
    input: 'delete mo pala yan',
    note: 'an added event is deleted through a Remove card, not "I\'ll leave it off"',
    setup: (now) => [{ id: uid(), title: 'Date with Iska', kind: 'protected', start: now + 30 * 60_000, end: now + 5.5 * 3_600_000, status: 'planned' }],
    history: [
      { role: 'user', content: 'date with iska 5hrs, mga 30mins mula ngayon' },
      { role: 'assistant', content: "Here's a 5-hour slot for your date!", action: { type: 'addEvent', title: 'Date with Iska', kind: 'protected' } },
      { role: 'user', content: 'sge' },
      { role: 'assistant', content: 'Added! Date with Iska is on your calendar.', action: { type: 'confirmEvent' } },
    ],
    expect: { action: 'removeEvent' },
  },
  { input: 'tanggalin mo yung cafe shift ko sa saturday', expect: { action: 'removeEvent' } },
  { input: 'sabado na prelims ko', expect: { action: ['createTask', 'none'], excludes: ['bukas na', 'tomorrow'] }, note: 'Saturday is not tomorrow' },
  { input: 'sabado na prelims ko', clock: SUN, expect: { action: ['createTask', 'none'], excludes: ['bukas'] }, note: 'the transcript: on a Sunday, Saturday is 6 days away' },
  {
    input: '4hrs',
    clock: SUN,
    history: [{ role: 'user', content: 'sabado na prelims ko' }, { role: 'assistant', content: 'Prelims sa Sabado! Ilang oras ng review ang kailangan mo?' }],
    expect: { action: ['createTask', 'findTime'] },
    note: 'the hours answer completes the task (or plans the review right away)',
  },
  { input: 'ano meron sakin bukas', expect: { action: ['analyzeWeek', 'none'], anyOf: ['Bio', 'Chem', 'Rizal'] }, note: 'names real events from the calendar' },
  { input: 'gusto ko mag aral everyday bago mag friday, 2 oras kada araw', expect: { action: 'findTime', has: ['perDay'] } },
  {
    input: 'okay',
    open: (now) => ({ type: 'plan', title: 'Prelims', blocks: [{ start: now + 3_600_000, end: now + 2.5 * 3_600_000 }] }),
    history: [{ role: 'user', content: 'plan my prelims review' }, { role: 'assistant', content: 'What if we split it up like this?', action: { type: 'findTime', title: 'Prelims' } }],
    expect: { action: 'confirmEvent' },
    note: '"okay" to the plan card accepts it',
  },
  {
    input: 'oo ikaw na bahala',
    note: 'answers Pal\'s last question (plan the review), not the older Math card',
    latest: false,
    open: (now) => { const m = at(now + 86_400_000, 7); return { type: 'event', title: 'Math', start: m, end: m + 2 * 3_600_000 } },
    history: [
      { role: 'user', content: 'lagyan mo sched ng pasok ko bukas 7am to 9am math' },
      { role: 'assistant', content: 'Math bukas 7-9am, add ko na?', action: { type: 'addEvent', title: 'Math', kind: 'class' } },
      { role: 'user', content: 'required ung math ko e ano pede gawin' },
      { role: 'assistant', content: 'Pwede nating ilipat yung study time mo. Gusto mo bang i-plan ko yung 4 hours para sa Prelims?' },
    ],
    expect: { notAction: 'confirmEvent' },
  },
]

function score(c: Case, text: string, a: AiAction | undefined, now: number) {
  const fails: string[] = []
  const action = a?.type
  const want = c.expect.action
  if (want && !(Array.isArray(want) ? want : [want]).includes(action ?? 'none')) fails.push(`action ${action ?? 'none'} ≠ ${want}`)
  if (c.expect.notAction && action === c.expect.notAction) fails.push(`action should not be ${action}`)
  // "4:13 pm" and "4:13pm" are the same answer
  const flat = (s: string) => s.toLowerCase().replace(/\s+/g, '')
  for (const s of c.expect.includes ?? []) {
    const needle = s === '{now}' ? fmtTime(now) : s
    if (!flat(text).includes(flat(needle))) fails.push(`missing "${needle}"`)
  }
  for (const s of c.expect.excludes ?? []) if (text.toLowerCase().includes(s.toLowerCase())) fails.push(`contains "${s}"`)
  if (c.expect.anyOf && !c.expect.anyOf.some((s) => text.toLowerCase().includes(s.toLowerCase()))) fails.push(`names none of ${c.expect.anyOf.join('/')}`)
  for (const k of c.expect.has ?? []) if (a?.[k] == null) fails.push(`no ${k}`)
  return fails
}

/** only: run just the model cases whose input matches (EVAL_ONLY="okkkk|sabado"), to spare the free-tier quota */
export async function runEval(opts: { llm?: boolean; apiKey?: string; pal?: PalId; log?: (s: string) => void; only?: string; local?: { url: string; model: string } } = {}) {
  const log = opts.log ?? console.log
  const pal = opts.pal ?? 'jhyvie'
  // Fixed Wednesday 4:13pm in the current week so seed deadlines are upcoming and results are repeatable
  const wed = new Date(); wed.setDate(wed.getDate() - ((wed.getDay() + 6) % 7) + 2); wed.setHours(16, 13, 0, 0)
  const now = wed.getTime()
  const { events, tasks } = seedWeek(now)
  const snap = buildContext(now, events, tasks, null)
  let pass = 0, total = 0

  log('── rules engine ──')
  for (const c of RULE_CASES) {
    const r = turn(c.input, { pal, now, draft: null, awaiting: null, lastEvent: c.lastEvent, waiting: c.waiting, waitingIsLatest: c.latest, facts: { next: snap.next } })
    const fails = score(c, r.text, r.action as AiAction | undefined, now)
    total++
    if (!fails.length) pass++
    log(`${fails.length ? '✗' : '✓'} ${c.input}  →  ${r.action?.type ?? ''} ${r.text}${fails.length ? `   [${fails.join('; ')}]` : ''}`)
  }
  for (const c of SANITIZE_CASES) {
    const ok = c.ok()
    total++
    if (ok) pass++
    log(`${ok ? '✓' : '✗'} sanitize: ${c.name}`)
  }
  const rules = { pass, total }

  if (!opts.llm && !opts.local) return { rules }
  // Your PC's model with the cloud off: free and unlimited, so it's the one to iterate against
  if (opts.local) useLocalAiForEval(opts.local.url, opts.local.model)
  const apiKey = opts.local ? '' : opts.apiKey ?? ''
  log(`\n── model (${opts.local ? `your PC: ${opts.local.model}` : apiKey ? 'Groq' : 'no key: local fallbacks only'}) ──`)
  pass = 0; total = 0
  // The waiting card sits tomorrow 9–10am, as in the real chat
  const t9 = new Date(now + 86_400_000).setHours(9, 0, 0, 0)
  for (const c of LLM_CASES) {
    if (opts.only && !new RegExp(opts.only, 'i').test(c.input)) continue
    const card: OpenCard | undefined = c.open?.(now) ?? (c.lastEvent ? { type: 'event', title: c.lastEvent.title, start: t9, end: t9 + 3_600_000 } : undefined)
    const clock = c.clock ?? now
    const facts = card || c.setup || c.clock || c.user ? buildContext(clock, [...events, ...(c.setup?.(clock) ?? [])], tasks, null, {}, { card, cardIsLatest: c.latest ?? true, user: c.user }) : snap
    const ask = () => askGroq(c.input, pal, apiKey, clock, c.history ?? [], facts, !!card)
    let r = await ask()
    // Every cloud model is out of its daily quota: more calls only fail, so stop instead of burning retries
    if (!r && aiFailure() === 'quota') {
      log('⏸ daily cloud quota reached, stopping. Try --local, or a separate GROQ_API_KEY for evals.')
      break
    }
    // Per-minute limit: wait it out and retry (cloud models skip themselves while they cool down)
    for (let tries = 0; !r && !opts.local && tries < 3; tries++) {
      await new Promise((ok) => setTimeout(ok, 20_000))
      r = await ask()
    }
    const fails = r ? score(c, r.text, r.action, clock) : ['no response']
    total++
    if (!fails.length) pass++
    log(`${fails.length ? '✗' : '✓'} ${c.input}  →  ${r?.action?.type ?? ''} ${r?.text ?? ''}${fails.length ? `   [${fails.join('; ')}]` : ''}`)
  }
  // The screenshot: Pal talked the event through in words and never sent a card. Recovery must find it.
  const said: ChatTurn[] = [
    { role: 'user', content: 'simba bukas 9am' },
    { role: 'assistant', content: 'Sige, Simba bukas 9am. Ilang oras?' },
    { role: 'user', content: '2' },
    { role: 'assistant', content: 'Ayan! Bukas 9-11am ang Simba. Tapos na ba o may ibang detalye?' },
    { role: 'user', content: 'wala na' },
    { role: 'assistant', content: 'Sige, i-lock ko na! Simba bukas 9-11am.' },
  ]
  // Recovery is a cloud-only call
  if (!opts.local) {
    const got = await recoverEvent(said, NOW, apiKey)
    const okRecover = !!got && /simba/i.test(got.title ?? '') && got.kind === 'protected' &&got.start === iso(T9) && got.end === iso(T9 + 2 * 3_600_000)
    total++
    if (okRecover) pass++
    log(`${okRecover ? '✓' : '✗'} recover the event Pal only talked about  →  ${JSON.stringify(got)}`)
  }
  if (cloudTokensUsed()) log(`cloud tokens used this run: ~${cloudTokensUsed().toLocaleString()} (free tier: 200,000/day per model)`)
  return { rules, llm: { pass, total } }
}
