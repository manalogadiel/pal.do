// Conversation eval: the "training data" for Pal. Tweak prompts / rules until this passes.
// Run: pnpm eval:chat            (rules engine only, offline)
//      GROQ_API_KEY=gsk_... pnpm eval:chat --llm   (also scores the online model)
import { turn, type LastEvent } from './agent'
import { buildContext } from './context'
import { fmtTime, seedWeek, type PalId } from './core'
import { askGroq, isGroundedEvent, recoverEvent, sanitizeAi, type AiAction, type ChatTurn } from './groq'

type Check = { action?: string | string[]; notAction?: string; includes?: string[]; excludes?: string[] }
export interface Case { input: string; expect: Check; lastEvent?: LastEvent; history?: ChatTurn[]; note?: string }

const NO_DODGE = ["didn't get", 'lost me', "don't understand", 'not sure what you mean']

// A card still waiting for the user's answer, and the turn that proposed it
const SIMBA: LastEvent = { title: 'Simba', kind: 'protected', start: 0, end: 3_600_000 }
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
  { input: 'no, its a lunch date', lastEvent: { title: 'Study Session', kind: 'work', start: 0, end: 3_600_000 }, expect: { action: 'reviseEvent', includes: [] } },
  { input: 'Bio quiz friday', expect: { excludes: NO_DODGE } },
  { input: "I don't study after 9pm", expect: { action: 'pref', includes: ['9pm'] } },
  { input: 'ayoko mag-aral lampas 10', expect: { action: 'pref', includes: ['10pm'] } },
  { input: 'keep sundays free please', expect: { action: 'pref', includes: ['Sundays'] } },
  { input: 'forget my preferences', expect: { action: 'pref' } },
  { input: 'keep friday free for my class 9-12', expect: { action: 'addEvent' }, note: 'a time range means a real event, not a rest-day preference' },
  // Offline safety net for answering the waiting card (online, the model reads intent)
  { input: 'tama', lastEvent: SIMBA, expect: { action: 'confirmEvent' } },
  { input: 'okkkk', lastEvent: SIMBA, expect: { action: 'confirmEvent' } },
  { input: 'sige ilagay mo na', lastEvent: SIMBA, expect: { action: 'confirmEvent' } },
  { input: 'wag na', lastEvent: SIMBA, expect: { action: 'skipEvent' } },
  { input: 'yes but make it 3pm', lastEvent: SIMBA, expect: { notAction: 'confirmEvent' }, note: 'a change is not a yes' },
  { input: 'make it 10 to 11 instead', lastEvent: SIMBA, expect: { action: 'reviseEvent' }, note: 'the app revises the card even when the model only talks' },
  { input: 'ok', expect: { notAction: 'confirmEvent' }, note: 'nothing waiting, nothing to confirm' },
]

// Fixed clock for the grounding cases: Sat Oct 10 2026, 10pm; "bukas 9am" is Sun 9am
const NOW = new Date(2026, 9, 10, 22, 0).getTime()
const T9 = new Date(2026, 9, 11, 9, 0).getTime()
const iso = (t: number) => { const d = new Date(t), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00` }

/** sanitizeAi: the guard between the model and the calendar. Must pass 100%. */
export const SANITIZE_CASES: { name: string; ok: () => boolean }[] = [
  { name: 'confirmEvent with no card waiting → none', ok: () => sanitizeAi({ text: 'Added!', action: { type: 'confirmEvent' } }, 'add it', 0, false)?.action?.type === 'none' },
  { name: 'confirmEvent with a card waiting is kept', ok: () => sanitizeAi({ text: 'Sige, adding it!', action: { type: 'confirmEvent' } }, 'push mo na', 0, true)?.action?.type === 'confirmEvent' },
  { name: 'skipEvent with no card waiting → none', ok: () => sanitizeAi({ text: 'Okay!', action: { type: 'skipEvent' } }, 'wag na', 0, false)?.action?.type === 'none' },
  { name: '"Done! Added" with no write is flagged', ok: () => sanitizeAi({ text: "Done! Added your simba for tomorrow.", action: { type: 'none' } }, 'tama', 0, true)?.claimed === true },
  { name: '"I\'ve locked in" with no write is flagged', ok: () => sanitizeAi({ text: "I've locked in your simba!", action: { type: 'none' } }, 'simba 9am', 0, false)?.claimed === true },
  { name: '"Want me to lock it in?" is a question, not a claim', ok: () => !sanitizeAi({ text: 'Moving it to 10-11am. Want me to lock it in?', action: { type: 'none' } }, 'hi', 0, false)?.claimed },
  { name: 'a plain question is not flagged', ok: () => !sanitizeAi({ text: 'Simba tomorrow 9-10am, want me to add it?', action: { type: 'none' } }, 'hi', 0, false)?.claimed },
  // Re-proposals grounded in an earlier message ("asan na" after "simba bukas 9 to 10am")
  { name: 'addEvent grounded in a recent user message is kept', ok: () => sanitizeAi({ text: 'Simba bukas 9-10am, tama ba?', action: { type: 'addEvent', title: 'Simba', start: '2026-10-11T09:00:00', end: '2026-10-11T10:00:00' } }, 'asan na', 0, false, 'simba bukas 9 to 10am')?.action?.type === 'addEvent' },
  { name: 'addEvent with no time anywhere → none', ok: () => sanitizeAi({ text: 'Gym?', action: { type: 'addEvent', title: 'Gym', start: '2026-10-11T09:00:00' } }, 'hi', 0, false, 'hello there')?.action?.type === 'none' },
  { name: 'yes to a cardless proposal becomes a card', ok: () => sanitizeAi({ text: 'Sige!', action: { type: 'confirmEvent', title: 'Simba', kind: 'protected', start: '2026-10-11T09:00:00', end: '2026-10-11T10:00:00' } }, 'oo', 0, false, 'simba bukas 9 to 10am')?.action?.type === 'addEvent' },
  {
    name: 'yes with no card and no details → none + claimed',
    ok: () => { const r = sanitizeAi({ text: 'Adding it now!', action: { type: 'confirmEvent' } }, 'oo', 0, false, ''); return r?.action?.type === 'none' && r.claimed === true },
  },
  { name: '"Adding Simba now" with no write is flagged', ok: () => sanitizeAi({ text: 'Got it! Adding Simba now.', action: { type: 'none' } }, 'oo', 0, false)?.claimed === true },
  { name: '"Let me lock it in again" with no write is flagged', ok: () => sanitizeAi({ text: 'Let me lock it in again: Simba bukas 9am.', action: { type: 'none' } }, 'asan na', 0, false)?.claimed === true },
  {
    name: 'ISO timestamps become human times',
    ok: () => { const t = sanitizeAi({ text: 'Adding Simba from 2026-10-11T09:00:00 to 2026-10-11T10:00:00.', action: { type: 'none' } }, 'hi', 0, false)?.text ?? ''; return !/\d{4}-\d{2}-\d{2}T/.test(t) && t.includes('9am') && t.includes('10am') },
  },
  { name: '"Sige, i-lock ko na!" with no write is flagged', ok: () => sanitizeAi({ text: 'Sige, i-lock ko na! Simba bukas 9-11am.', action: { type: 'none' } }, 'wala na', 0, false)?.claimed === true },
  { name: '"i-add ko na ba?" is a question, not a claim', ok: () => !sanitizeAi({ text: 'Simba 9am. Sige, i-add ko na ba?', action: { type: 'none' } }, '9am', 0, false)?.claimed },
  // A recovered event only counts if its time is in text the user actually saw
  { name: 'recovered event grounded in the chat is accepted', ok: () => isGroundedEvent({ type: 'addEvent', title: 'Simba', start: iso(T9), end: iso(T9 + 2 * 3_600_000) }, ['Ayan! Bukas 9-11am ang Simba.'], NOW) },
  { name: 'recovered event at a time nobody said is rejected', ok: () => !isGroundedEvent({ type: 'addEvent', title: 'Simba', start: iso(T9 + 3_600_000), end: iso(T9 + 2 * 3_600_000) }, ['Ayan! Bukas 9-11am ang Simba.'], NOW) },
  { name: 'recovered event with no title is rejected', ok: () => !isGroundedEvent({ type: 'addEvent', start: iso(T9), end: iso(T9 + 3_600_000) }, ['Bukas 9-10am.'], NOW) },
  {
    name: '[Proposed event …] and \\n are stripped',
    ok: () => sanitizeAi({ text: 'Got it, 9 to 10am! [Proposed event: Simba, Sun, Oct 11 9am-10am]\\n', action: { type: 'none' } }, 'hi', 0, false)?.text === 'Got it, 9 to 10am!',
  },
]

/** Model behaviour: scored, not required to be perfect. Same calendar as the rules cases. */
export const LLM_CASES: Case[] = [
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
  { input: 'math exam next tuesday', expect: { action: ['createTask', 'addEvent'] } },
  { input: 'what time is it?', expect: { action: 'none', includes: ['{now}'] } },
  { input: 'hi', expect: { action: 'none' } },
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
]

function score(c: Case, text: string, action: string | undefined, now: number) {
  const fails: string[] = []
  const want = c.expect.action
  if (want && !(Array.isArray(want) ? want : [want]).includes(action ?? 'none')) fails.push(`action ${action ?? 'none'} ≠ ${want}`)
  if (c.expect.notAction && action === c.expect.notAction) fails.push(`action should not be ${action}`)
  for (const s of c.expect.includes ?? []) {
    const needle = s === '{now}' ? fmtTime(now) : s
    if (!text.toLowerCase().includes(needle.toLowerCase())) fails.push(`missing "${needle}"`)
  }
  for (const s of c.expect.excludes ?? []) if (text.toLowerCase().includes(s.toLowerCase())) fails.push(`contains "${s}"`)
  return fails
}

export async function runEval(opts: { llm?: boolean; apiKey?: string; pal?: PalId; log?: (s: string) => void } = {}) {
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
    const r = turn(c.input, { pal, now, draft: null, awaiting: null, lastEvent: c.lastEvent, facts: { next: snap.next } })
    const fails = score(c, r.text, r.action?.type, now)
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

  if (!opts.llm) return { rules }
  log(`\n── model (${opts.apiKey ? 'Groq' : 'no key: local fallbacks only'}) ──`)
  pass = 0; total = 0
  // The waiting card sits tomorrow 9–10am, as in the real chat
  const t9 = new Date(now + 86_400_000).setHours(9, 0, 0, 0)
  for (const c of LLM_CASES) {
    const facts = c.lastEvent ? buildContext(now, events, tasks, null, {}, { ...c.lastEvent, start: t9, end: t9 + 3_600_000 }) : snap
    const ask = () => askGroq(c.input, pal, opts.apiKey ?? '', now, c.history ?? [], facts, !!c.lastEvent)
    // Free tier is ~5 requests/min per model: on an empty reply, wait out the rate limit and retry
    let r = await ask()
    for (let tries = 0; !r && tries < 3; tries++) {
      await new Promise((ok) => setTimeout(ok, 20_000))
      r = await ask()
    }
    const a: AiAction['type'] | undefined = r?.action?.type
    const fails = r ? score(c, r.text, a, now) : ['no response']
    total++
    if (!fails.length) pass++
    log(`${fails.length ? '✗' : '✓'} ${c.input}  →  ${a ?? ''} ${r?.text ?? ''}${fails.length ? `   [${fails.join('; ')}]` : ''}`)
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
  const got = await recoverEvent(said, NOW, opts.apiKey ?? '')
  const okRecover = !!got && /simba/i.test(got.title ?? '') && got.kind === 'protected' &&got.start === iso(T9) && got.end === iso(T9 + 2 * 3_600_000)
  total++
  if (okRecover) pass++
  log(`${okRecover ? '✓' : '✗'} recover the event Pal only talked about  →  ${JSON.stringify(got)}`)
  return { rules, llm: { pass, total } }
}
