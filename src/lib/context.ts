// Facts the app computes so the model only has to phrase them. Small models hallucinate times and numbers.
import { addDays, DAY, fmtDay, fmtDur, fmtHours, fmtTime, hoursOf, startOfDay, type CalEvent, type Task } from './core'
import { freeGaps, type Prefs } from './schedule'
import { weatherLine, type Weather } from './weather'

export interface Snapshot {
  /** The facts block for the models (Groq / Ollama) */
  full: string
  /** "your Bio quiz on Fri" — for offline redirect lines */
  next: string
  /** "2.5h" free for the rest of today */
  freeToday: string
  /** One or two sentences of schedule analysis */
  insight: string
  /** "Bio class 1pm–3pm, Shift 6pm–10pm" or "nothing else" */
  today: string
  /** Weather sentence fragment, or '' when unknown */
  weather: string
  /** Short ids the model may use ("e3") → real event ids in this bounded snapshot. */
  refs: Record<string, string>
}

const BOOKED = new Set(['class', 'shift', 'work', 'exam', 'protected'])
const short = (t: number) => new Date(t).toLocaleDateString('en-US', { weekday: 'short' })
const span = (s: number, e: number) => `${fmtDay(s)} ${fmtTime(s)}–${fmtTime(e)}`
const DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const TAGALOG = ['Linggo', 'Lunes', 'Martes', 'Miyerkules', 'Huwebes', 'Biyernes', 'Sabado']

/** The card a typed yes/no would answer, as the model should see it */
export type OpenCard =
  | { type: 'event'; title: string; start: number; end: number; days?: number[]; until?: number; clash?: string[]; alt?: { start: number; end: number }; blocked?: string[] }
  | { type: 'plan'; title: string; blocks: { start: number; end: number }[] }
  | { type: 'task'; title: string; kind: string; due: number; hours: number }
  | { type: 'change'; mode: 'remove' | 'move'; title: string; start: number; end: number; to?: { start: number; end: number } }

export interface Open {
  card?: OpenCard | null
  /** false: Pal said something else after the card, so a bare "oo" may answer that instead */
  cardIsLatest?: boolean
  /** A task still being filled in, with no card yet */
  draft?: { title: string; kind: string; due?: number; hours?: number } | null
  /** What the user asked to be called (Settings) */
  user?: string
  focusTitle?: string
}

function describeCard(c: OpenCard) {
  if (c.type === 'event') {
    const days = c.days?.length ? ` every ${c.days.map((d) => DAYN[d]).join(', ')}${c.until ? ` until ${fmtDay(c.until)}` : ''}` : ''
    // An overlap: the app already asked about it, so the model knows a yes means the offered time
    const clash = c.clash?.length ? ` (overlaps ${c.clash.join(' and ')}${c.alt ? `; you offered ${fmtTime(c.alt.start)}–${fmtTime(c.alt.end)} instead, which a plain yes takes` : ''})` : ''
    const blocked = c.blocked?.length ? ` (lands on study block ${c.blocked.join(' and ')}; adding it moves that block to a new time)` : ''
    return `add "${c.title}" ${span(c.start, c.end)}${days}${clash}${blocked}`
  }
  if (c.type === 'plan') return `study plan for ${c.title}: ${c.blocks.length ? c.blocks.map((b) => span(b.start, b.end)).join(', ') : 'no times fit'}`
  if (c.type === 'task') return `${c.kind} "${c.title}" ${c.kind === 'exam' ? 'on' : 'due'} ${fmtDay(c.due)}, ${fmtDur(c.hours)} of ${c.kind === 'exam' ? 'review' : 'work'}`
  return c.mode === 'remove' ? `remove "${c.title}" (${span(c.start, c.end)})` : `move "${c.title}" from ${span(c.start, c.end)} to ${c.to ? span(c.to.start, c.to.end) : '?'}`
}

/** "Sat=2026-10-17 (Sabado, in 6 days)": the model reads relative days from here, never from its own math */
export function relativeDays(now: number, n = 7) {
  const pad = (x: number) => String(x).padStart(2, '0')
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(addDays(startOfDay(now), i))
    const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    const rel = i === 0 ? 'today/ngayon' : i === 1 ? 'tomorrow/bukas' : `in ${i} days`
    return `${DAYN[d.getDay()]}=${iso} (${TAGALOG[d.getDay()]}, ${rel})`
  }).join(', ')
}

export function buildContext(now: number, events: CalEvent[], tasks: Task[], weather: Weather | null, prefs: Prefs = {}, open: Open = {}): Snapshot {
  const busy = events.filter((e) => e.status !== 'done' && e.status !== 'missed')
  const today = startOfDay(now)
  const clock = `${new Date(now).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}, ${fmtTime(now)}`

  const left = busy
    .filter((e) => e.end > now && e.start < today + DAY && e.kind !== 'commute' && e.kind !== 'deadline' && e.status !== 'proposed')
    .sort((a, b) => a.start - b.start)
  const leftLine = left.length ? left.slice(0, 4).map((e) => `${e.title} ${fmtTime(e.start)}–${fmtTime(e.end)}${e.start <= now ? " (happening now)" : ""}`).join(', ') : 'nothing else'

  const gapsToday = freeGaps(today, now, today + DAY, busy, prefs)
  const freeH = gapsToday.reduce((a, g) => a + (g.e - g.s), 0) / 3_600_000
  const gapLine = gapsToday.slice(0, 3).map((g) => `${fmtTime(g.s)}–${fmtTime(g.e)}`).join(', ')

  const week = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(today, i)
    const free = freeGaps(d, Math.max(now, d), d + DAY, busy, prefs).reduce((a, g) => a + (g.e - g.s), 0) / 3_600_000
    const booked = busy.filter((e) => BOOKED.has(e.kind) && e.start >= d && e.start < d + DAY).reduce((a, e) => a + hoursOf(e), 0)
    return { d, free, booked }
  })
  const busiest = [...week].sort((a, b) => b.booked - a.booked)[0]

  // What's actually on the calendar, with short ids the model uses to remove or move one
  const refs: Record<string, string> = {}
  const focusTitle = open.focusTitle || open.card?.title || open.draft?.title
  const words = focusTitle?.toLowerCase().split(/\W+/).filter((word) => word.length > 2 && !['review', 'study', 'exam', 'the', 'for'].includes(word)) ?? []
  const relevant = (e: CalEvent) => words.length > 0 && words.every((word) => e.title.toLowerCase().includes(word))
  const upcoming = busy
    // Commutes only for today and tomorrow (a daily bus ride would crowd out the week), so "move my bus" can find it
    .filter((e) => (e.status === 'planned' || e.status === 'proposed') && (e.kind !== 'commute' || e.start < today + 2 * DAY) && e.kind !== 'deadline' && e.end > now && e.start < today + 7 * DAY)
    .sort((a, b) => Number(relevant(b)) - Number(relevant(a)) || a.start - b.start)
    .slice(0, 10)
    .map((e, i) => {
      refs[`e${i + 1}`] = e.id
      return `e${i + 1} ${span(e.start, e.end)} ${e.title} (${e.status}, ${e.taskId && e.kind === 'work' ? 'review session' : e.kind}${e.taskId ? `; task ${e.taskId}` : ''})`
    })

  const upcomingTasks = tasks.filter((t) => t.due > now).sort((a, b) => a.due - b.due)
  const plannedFor = (t: Task) => busy.filter((e) => e.taskId === t.id && e.kind === 'work' && e.status === 'planned' && e.start >= now).reduce((a, e) => a + hoursOf(e), 0)
  const taskLine = (t: Task) => `${t.title} (${t.kind}), ${fmtDay(t.due)} ${fmtTime(t.due)} (needs ${fmtDur(Math.max(0, t.hours - t.doneHours))} of review/work, ${fmtDur(plannedFor(t))} planned)`
  const nextTask = upcomingTasks[0]
  const atRisk = upcomingTasks.filter((t) => t.due - now < 3 * DAY && t.doneHours + plannedFor(t) < t.hours)

  const insight = [
    busiest && busiest.booked > 0 ? `${short(busiest.d)} is your heaviest day (${fmtHours(busiest.booked)} booked).` : 'Your week is pretty open.',
    atRisk.length
      ? `${atRisk[0].title} is due ${fmtDay(atRisk[0].due)} and doesn't have enough study time yet.`
      : nextTask ? `Next up: ${nextTask.title}, ${fmtDay(nextTask.due)}.` : '',
  ].filter(Boolean).join(' ')

  const prefLine = [
    prefs.latestHour != null ? `nothing after ${fmtTime(new Date(now).setHours(prefs.latestHour, 0, 0, 0))}` : '',
    prefs.blockedDays?.length ? `keep ${prefs.blockedDays.map((d) => DAYN[d]).join(', ')} free` : '',
  ].filter(Boolean).join('; ')
  const wx = weather ? weatherLine(weather) : 'unknown (offline or not fetched yet)'
  const wait = open.card
    ? `WAITING FOR THE USER'S ANSWER: ${describeCard(open.card)}. Not done yet. If their message is a yes/okay/go to this, send confirmEvent (not a new card); "no/drop it/not now" → skipEvent.${open.cardIsLatest === false ? ' You said something else after this card, so a bare "oo" might answer your last question instead: if unsure, ask which.' : ''}`
    : ''
  const d = open.draft
  const draftLine = d
    ? `Task being set up (no card yet): ${d.title} (${d.kind}), ${d.due ? `${d.kind === 'exam' ? 'on' : 'due'} ${fmtDay(d.due)}` : 'date not given'}, ${d.hours ? fmtDur(d.hours) : 'hours not given'}. Once you know all three, send createTask.`
    : ''
  const user = open.user?.trim()
  // Small models took "they may call you jv" as the user's name: say whose name is whose
  const userLine = user ? `\n- The user is ${user}: call them ${user} now and then. Your own names and nicknames are never theirs.` : ''
  const full = `APP FACTS (computed by the app; use these, never invent times, dates, free slots or weather):${userLine}
- Now: ${clock}
- Still today: ${leftLine}
- Free today: ${fmtDur(freeH)}${gapLine ? ` (${gapLine})` : ''}
- Free next 7 days: ${week.map((w) => `${short(w.d)} ${fmtDur(w.free)}`).join(', ')}${busiest && busiest.booked > 0 ? ` (busiest: ${short(busiest.d)}, ${fmtDur(busiest.booked)} booked)` : ''}
- Calendar next 7 days (id,time,title,status/role; proposed=unaccepted): ${upcoming.length ? `\n  ${upcoming.join('\n  ')}` : 'nothing'}${upcoming.length === 10 ? ' (limited list; ask for day/title before declaring an event absent)' : ''}
- Deadlines: ${upcomingTasks.length ? upcomingTasks.slice(0, 4).map(taskLine).join('; ') : 'none'}
- Needs attention: ${atRisk.length ? atRisk.map((t) => `${t.title} due ${fmtDay(t.due)}`).join('; ') : 'nothing'}
- Weather: ${wx}${prefLine ? `
- User preferences (always respect): ${prefLine}` : ''}${wait ? `
- ${wait}` : ''}${draftLine ? `
- ${draftLine}` : ''}`

  return {
    full,
    next: nextTask ? `your ${nextTask.title} on ${short(nextTask.due)}` : 'your week',
    freeToday: fmtHours(freeH),
    insight,
    today: leftLine,
    weather: weather ? weatherLine(weather) : '',
    refs,
  }
}
