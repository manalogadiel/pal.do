// Conversation eval: the "training data" for Pal. Tweak prompts / rules until this passes.
// Run: pnpm eval:chat            (rules engine only, offline)
//      GROQ_API_KEY=gsk_... pnpm eval:chat --llm   (also scores the online model)
import { turn, type LastEvent } from './agent'
import { buildContext } from './context'
import { fmtTime, seedWeek, type PalId } from './core'
import { askGroq, type AiAction } from './groq'

type Check = { action?: string | string[]; includes?: string[]; excludes?: string[] }
export interface Case { input: string; expect: Check; lastEvent?: LastEvent; note?: string }

const NO_DODGE = ["didn't get", 'lost me', "don't understand", 'not sure what you mean']

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
]

function score(c: Case, text: string, action: string | undefined, now: number) {
  const fails: string[] = []
  const want = c.expect.action
  if (want && !(Array.isArray(want) ? want : [want]).includes(action ?? 'none')) fails.push(`action ${action ?? 'none'} ≠ ${want}`)
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
  const rules = { pass, total }

  if (!opts.llm) return { rules }
  log(`\n── model (${opts.apiKey ? 'Groq' : 'no key: local fallbacks only'}) ──`)
  pass = 0; total = 0
  for (const c of LLM_CASES) {
    // Free tier is ~5 requests/min per model: on an empty reply, wait out the rate limit and retry
    let r = await askGroq(c.input, pal, opts.apiKey ?? '', now, [], snap)
    for (let tries = 0; !r && tries < 3; tries++) {
      await new Promise((ok) => setTimeout(ok, 20_000))
      r = await askGroq(c.input, pal, opts.apiKey ?? '', now, [], snap)
    }
    const a: AiAction['type'] | undefined = r?.action?.type
    const fails = r ? score(c, r.text, a, now) : ['no response']
    total++
    if (!fails.length) pass++
    log(`${fails.length ? '✗' : '✓'} ${c.input}  →  ${a ?? ''} ${r?.text ?? ''}${fails.length ? `   [${fails.join('; ')}]` : ''}`)
  }
  return { rules, llm: { pass, total } }
}
