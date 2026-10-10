// Facts the app computes so the model only has to phrase them. Small models hallucinate times and numbers.
import { addDays, DAY, fmtDay, fmtHours, fmtTime, hoursOf, startOfDay, type CalEvent, type Task } from './core'
import { freeGaps, type Prefs } from './schedule'
import { weatherLine, type Weather } from './weather'

export interface Snapshot {
  /** Full block for big models (Groq / Ollama) */
  full: string
  /** 3–4 lines for the in-browser model's small context */
  short: string
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
}

const BOOKED = new Set(['class', 'shift', 'work', 'exam', 'protected'])
const short = (t: number) => new Date(t).toLocaleDateString('en-US', { weekday: 'short' })

/** The event card still waiting for the user's answer in chat */
export type Waiting = { title: string; start: number; end: number } | null | undefined

export function buildContext(now: number, events: CalEvent[], tasks: Task[], weather: Weather | null, prefs: Prefs = {}, waiting?: Waiting): Snapshot {
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

  const upcoming = tasks.filter((t) => t.due > now).sort((a, b) => a.due - b.due)
  const plannedFor = (t: Task) => busy.filter((e) => e.taskId === t.id && e.kind === 'work' && e.status === 'planned' && e.start >= now).reduce((a, e) => a + hoursOf(e), 0)
  const nextTask = upcoming[0]
  const nextLine = nextTask ? `${nextTask.title}, ${fmtDay(nextTask.due)} (needs ${fmtHours(nextTask.hours - nextTask.doneHours)}, ${fmtHours(plannedFor(nextTask))} planned)` : 'none'
  const atRisk = upcoming.filter((t) => t.due - now < 3 * DAY && t.doneHours + plannedFor(t) < t.hours)

  const insight = [
    busiest && busiest.booked > 0 ? `${short(busiest.d)} is your heaviest day (${fmtHours(busiest.booked)} booked).` : 'Your week is pretty open.',
    atRisk.length
      ? `${atRisk[0].title} is due ${fmtDay(atRisk[0].due)} and doesn't have enough study time yet.`
      : nextTask ? `Next up: ${nextTask.title}, ${fmtDay(nextTask.due)}.` : '',
  ].filter(Boolean).join(' ')

  const DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const prefLine = [
    prefs.latestHour != null ? `nothing after ${fmtTime(new Date(now).setHours(prefs.latestHour, 0, 0, 0))}` : '',
    prefs.blockedDays?.length ? `keep ${prefs.blockedDays.map((d) => DAYN[d]).join(', ')} free` : '',
  ].filter(Boolean).join('; ')
  const wx = weather ? weatherLine(weather) : 'unknown (offline or not fetched yet)'
  const wait = waiting
    ? `WAITING FOR CONFIRM: ${waiting.title}, ${fmtDay(waiting.start)} ${fmtTime(waiting.start)}–${fmtTime(waiting.end)}. Not on the calendar yet; only the user can add it (Add it button, or telling you to go ahead → confirmEvent).`
    : ''
  const full = `APP FACTS (computed by the app; use these, never invent times, dates, free slots or weather):
- Now: ${clock}
- Still today: ${leftLine}
- Free today: ${fmtHours(freeH)}${gapLine ? ` (${gapLine})` : ''}
- Free hours next 7 days: ${week.map((w) => `${short(w.d)} ${fmtHours(w.free)}`).join(', ')}
- Busiest day: ${busiest && busiest.booked > 0 ? `${short(busiest.d)} (${fmtHours(busiest.booked)} booked)` : 'none'}
- Next deadline: ${nextLine}
- Needs attention: ${atRisk.length ? atRisk.map((t) => `${t.title} due ${fmtDay(t.due)}`).join('; ') : 'nothing'}
- Weather: ${wx}${prefLine ? `
- User preferences (always respect): ${prefLine}` : ''}${wait ? `
- ${wait}` : ''}`

  const shortBlock = `Now: ${clock}. Still today: ${leftLine}. Free today: ${fmtHours(freeH)}.
Next deadline: ${nextLine}. Weather: ${wx}.${wait ? ` ${wait}` : ''}`

  return {
    full,
    short: shortBlock,
    next: nextTask ? `your ${nextTask.title} on ${short(nextTask.due)}` : 'your week',
    freeToday: fmtHours(freeH),
    insight,
    today: leftLine,
    weather: weather ? weatherLine(weather) : '',
  }
}
