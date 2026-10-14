import { datedTasks, isTaskDone } from './tasks'
// Questions about their own schedule, answered from the calendar itself: instant, exact, the same on every model and
// offline. "What are my plans tomorrow?", "when am I free today?", "what's my next schedule?", "how much time before my
// Bio exam?", "what's due this week?". Advice ("what do you suggest?") is the model's; this only states facts.
import { at, DAY, fmtDay, fmtDur, fmtReplyTime as fmtTime, HOUR, startOfDay, startOfWeek, type CalEvent, type Kind, type Task } from './core'
import { clockTime, namedDay, parseHours, parseWhen } from './parse'
import { freeGaps, type Prefs } from './schedule'
import { weekInsights } from './insights'

export type ScheduleQuestion =
  | { type: 'day'; day: number; kinds?: Kind[]; label: string }
  | { type: 'week'; offset: number }
  | { type: 'free'; day: number; from?: number; to?: number; label: string }
  | { type: 'freeAt'; t: number }
  | { type: 'freeFor'; hours: number; day?: number }
  | { type: 'next'; n: number }
  | { type: 'now' }
  | { type: 'when'; query: string }
  | { type: 'countdown'; query: string }
  | { type: 'due'; days: number }
  | { type: 'insights' }

/** A request, not a question: "can you add gym at 5?", "pwede mo bang ilipat…" */
const REQUEST = /\b(add|put|book|set up|move|resched\w*|cancel|remove|delete|lagay|ilagay|ilipat|lipat|tanggal\w*|alisin|remind me|paalala|create|make (a|an|me)|schedule (a|an|my|me|it|this|that))\b/i
/** Wants advice or a plan: the model answers, with these facts in its brief */
const ADVICE = /\b(suggest|recommend|should i(?! be doing)|advice|advise|ideas?|best time|kailan (ko )?dapat|ano (ang )?mas maganda|is it ok|squeeze|fit in|balance)\b/i
/** "Any bad habits?", "how's my week looking?", "am I on track?", "am I overloaded?" */
const INSIGHT = /\b(bad habits?|habits?|anything (wrong|off|i should (fix|change))|overload(ed)?|too (much|busy|packed)|on track|looking (good|ok|okay|healthy)|how('?s| is) my (week|schedule) looking|healthy|balanced)\b/i
const KIND_WORDS: [RegExp, Kind[]][] = [
  [/\b(exams?|quiz(zes)?|tests?|midterms?|finals?|prelims?)\b/i, ['exam']],
  [/\b(class(es)?|klase|pasok|lecture|lab)\b/i, ['class']],
  [/\b(shifts?|duty|work)\b/i, ['shift']],
  [/\b(deadlines?|due|submissions?|requirements?)\b/i, ['deadline']],
]
const SCHEDULE_WORDS = /\b(plans?|schedules?|sched|agenda|calendar|ganap|gagawin|lakad|happening|on my plate|do i have|have i got|may .* ba|meron (ba )?ako|anong? (mga )?plano|plano ko|anong? (meron|ganap|sched\w*)|what'?s on|what is on|what do i have)\b/i

/** "tonight" → 5pm–midnight; "this afternoon" → noon–6pm; "this morning" → 5am–noon */
function partOfDay(text: string, day: number): { from?: number; to?: number; label?: string } {
  if (/\b(tonight|this evening|evening|gabi|mamayang gabi)\b/i.test(text)) return { from: at(day, 17), to: at(day, 24), label: 'tonight' }
  if (/\b(afternoon|hapon)\b/i.test(text)) return { from: at(day, 12), to: at(day, 18), label: 'this afternoon' }
  if (/\b(morning|umaga)\b/i.test(text)) return { from: at(day, 5), to: at(day, 12), label: 'this morning' }
  return {}
}

function dayOf(text: string, now: number): number {
  const named = namedDay(text, now)
  if (named != null) return named
  const w = parseWhen(text, now)
  return w ? startOfDay(w.t) : startOfDay(now)
}

const dayLabel = (day: number, now: number) => (day === startOfDay(now) ? 'today' : day === startOfDay(now) + DAY ? 'tomorrow' : `on ${fmtDay(day)}`)

/** Null when it isn't a question about their own schedule (then the model answers, or it's a request) */
export function parseScheduleQuestion(text: string, now: number): ScheduleQuestion | null {
  // "No, I'm asking if I have an exam tomorrow": the question is what follows
  const t = text.trim().replace(/^\W*(?:no+|nope|hindi|di)\b[\s,.!]*/i, '').replace(/^(?:i'?m|i am|im)\s+(?:just\s+)?asking\s+(?:if|whether|kung)\s+(?:i\s+)?/i, 'do i ').replace(/^tinatanong ko (?:kung|if)\s+/i, '')
  if (REQUEST.test(t) || ADVICE.test(t)) return null
  const asks = /\?\s*$/.test(t) || /^\W*(what|when|which|how|do|does|am|is|are|will|can|ano|anong|kailan|ilang|may|meron|sino|saan|show|tell|list|give)\b/i.test(t)
  if (!asks) return null

  if (INSIGHT.test(t)) return { type: 'insights' }
  // Countdown: "how much time before my Bio exam", "how many days until midterms", "ilang araw na lang bago finals"
  const cd = t.match(/\b(?:how (?:much|many) (?:time|days?|hours?|weeks?)(?: do i have)?(?: left)?|how long|ilang (?:araw|oras|linggo)(?: na lang)?)\s+(?:is it\s+)?(?:left\s+)?(?:before|until|till|til|bago|hanggang|to)\s+(?:the\s+|my\s+|ang\s+|yung\s+)?(.+?)\??$/i)
  if (cd) return { type: 'countdown', query: cd[1] }
  // "When is my Bio exam?", "kailan ang finals ko"
  const when = t.match(/^\W*(?:when(?:'s| is| are| does| do)?|kailan(?: ang| yung)?)\s+(?:my\s+|the\s+)?(.+?)(?:\s+ko)?\??$/i)
  if (when && !/\b(free|bakante|available)\b/i.test(t) && !/^(i|we)\b/i.test(when[1])) return { type: 'when', query: when[1].replace(/\b(start|begin|due|happen)s?\b/gi, '').trim() }

  // Free time: "am I free at 3pm tomorrow", "free for 2 hours this week", "my free time tonight"
  if (/\b(free|bakante|vacant|available|open time|walang ganap)\b/i.test(t)) {
    const day = dayOf(t, now)
    const clock = clockTime(t)
    if (clock && /\bat\b|\b\d/.test(t)) return { type: 'freeAt', t: at(day, clock[0], clock[1]) }
    const hours = /\bfor\b|\boras\b/i.test(t) ? parseHours(t) : null
    if (hours) return { type: 'freeFor', hours, day: /\b(this week|week|linggo)\b/i.test(t) ? undefined : day }
    const part = partOfDay(t, day)
    return { type: 'free', day, from: part.from, to: part.to, label: part.label ?? dayLabel(day, now) }
  }

  // Next: "what's my next schedule", "what are my next schedules", "next 3 things", "ano susunod ko"
  if (/\bnext\b|\bsusunod\b|\bafter this\b|\bpagkatapos\b/i.test(t)) {
    const n = Number(t.match(/\bnext (\d+)\b/i)?.[1] ?? (/\b(schedules|events|things|ones|classes|plans)\b|\bare my next\b/i.test(t) ? 3 : 1))
    return { type: 'next', n: Math.min(Math.max(n, 1), 6) }
  }
  // Now: "what should I be doing now", "what's happening now"
  if (/\b(right now|now|ngayon na|currently)\b/i.test(t) && /\b(what|ano|doing|happening|ginagawa)\b/i.test(t) && !/\b(today|tonight|bukas|tomorrow)\b/i.test(t)) return { type: 'now' }

  // Due: "what's due this week", "closest deadline", "anong deadlines ko"
  if (/\b(due|deadlines?|submissions?|requirements?)\b/i.test(t)) return { type: 'due', days: /\bnext week\b/i.test(t) ? 14 : /\b(today|ngayon)\b/i.test(t) ? 1 : 7 }

  // Week: "how busy is my week", "heaviest day", "what's my week like"
  if (/\b(how busy|busiest|heaviest|my week|this week|next week|linggo)\b/i.test(t) && !/\b(today|tomorrow|tonight|bukas|ngayon)\b/i.test(t)) return { type: 'week', offset: /\bnext week\b/i.test(t) ? 1 : 0 }

  // Plans on a day: "what are my plans tomorrow", "do I have an exam tomorrow", "anong sched ko sa Friday"
  const kinds = KIND_WORDS.find(([re]) => re.test(t))?.[1]
  if (SCHEDULE_WORDS.test(t) || kinds) {
    const day = dayOf(t, now)
    return { type: 'day', day, kinds, label: dayLabel(day, now) }
  }
  return null
}

export interface ScheduleData { events: CalEvent[]; tasks: Task[]; now: number; prefs?: Prefs; taglish?: boolean }


/** "2 days 4h", "3h 20m", "45m" */
function until(ms: number) {
  if (ms <= 0) return 'now'
  const d = Math.floor(ms / DAY)
  const rest = ms - d * DAY
  if (d >= 1) return `${d} day${d > 1 ? 's' : ''}${rest >= HOUR ? ` ${Math.floor(rest / HOUR)}h` : ''}`
  return fmtDur(ms / HOUR)
}
const span = (e: CalEvent) => (e.kind === 'deadline' ? `${e.title}, due ${fmtTime(e.start)}` : `${e.title} ${fmtTime(e.start)}–${fmtTime(e.end)}${startOfDay(e.end) !== startOfDay(e.start) ? ` (${fmtDay(e.end)})` : ''}`)
const list = (items: string[], max = 6) => (items.length > max ? `${items.slice(0, max).join('; ')}; and ${items.length - max} more` : items.join('; '))
const words = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !/^(my|the|ang|ko|yung|sa|na|ba|is|are|of|for|to)$/.test(w))

/** What's on the calendar for real: planned or done, not suggestions they haven't accepted */
const real = (events: CalEvent[]) => events.filter((e) => e.status === 'planned' || e.status === 'done')

export function answerScheduleQuestion(q: ScheduleQuestion, d: ScheduleData): string {
  const { now } = d
  const tl = !!d.taglish
  const ev = real(d.events).sort((a, b) => a.start - b.start)
  const L = (en: string, tagalog: string) => (tl ? tagalog : en)

  if (q.type === 'day') {
    const items = ev.filter((e) => startOfDay(e.start) === q.day && (q.day !== startOfDay(now) || e.end > now) && (!q.kinds || q.kinds.includes(e.kind) || (q.kinds.includes('deadline') && !!e.taskId && e.kind === 'deadline')))
    const tasks = q.kinds?.includes('exam') ? datedTasks(d.tasks).filter((t) => t.kind === 'exam' && startOfDay(t.due) === q.day && !items.some((e) => e.taskId === t.id)) : []
    const all = [...items.map(span), ...tasks.map((t) => `${t.title} ${fmtTime(t.due)}`)]
    const what = q.kinds ? (q.kinds[0] === 'exam' ? L('exams', 'exam') : q.kinds[0] === 'class' ? L('classes', 'klase') : q.kinds[0] === 'shift' ? L('shifts', 'shift') : L('deadlines', 'deadline')) : ''
    const label = q.day === startOfDay(now) && !q.kinds ? L('Still today', 'Natitira ngayon') : `${q.label[0].toUpperCase()}${q.label.slice(1)}`
    const rest = q.day === startOfDay(now) ? L(' left', ' na natitira') : ''
    if (!all.length) return q.kinds ? L(`No ${what}${rest} ${q.label}.`, `Walang ${what}${rest} ${q.label}.`) : L(`Nothing${rest} on your calendar ${q.label}. You're free.`, `Wala ka nang naka-sched ${q.label}. Free ka.`)
    return q.kinds ? L(`Yes, ${q.label}: ${list(all)}.`, `Oo, ${q.label}: ${list(all)}.`) : `${label}: ${list(all)}.`
  }

  if (q.type === 'free') {
    const from = Math.max(now, q.from ?? q.day)
    const gaps = freeGaps(q.day, from, q.to ?? q.day + DAY, ev, d.prefs)
    if (!gaps.length) return L(`You're booked ${q.label}, no free 45-minute window left.`, `Puno ka ${q.label}, walang bakanteng 45 minutes.`)
    const total = gaps.reduce((a, g) => a + (g.e - g.s), 0) / HOUR
    return L(`Free ${q.label}: ${gaps.map((g) => `${fmtTime(g.s)}–${fmtTime(g.e)}`).join(', ')} (${fmtDur(total)} total).`, `Bakante ka ${q.label}: ${gaps.map((g) => `${fmtTime(g.s)}–${fmtTime(g.e)}`).join(', ')} (${fmtDur(total)} lahat).`)
  }

  if (q.type === 'freeAt') {
    const busy = ev.find((e) => e.kind !== 'deadline' && e.start <= q.t && e.end > q.t)
    const when = `${startOfDay(q.t) === startOfDay(now) ? '' : `${fmtDay(q.t)} `}${fmtTime(q.t)}`
    if (busy) return L(`No, you have ${busy.title} until ${fmtTime(busy.end)} then.`, `Hindi, may ${busy.title} ka hanggang ${fmtTime(busy.end)}.`)
    const nextUp = ev.find((e) => e.kind !== 'deadline' && e.start > q.t && startOfDay(e.start) === startOfDay(q.t))
    return nextUp ? L(`Yes, you're free at ${when}, until ${nextUp.title} at ${fmtTime(nextUp.start)}.`, `Oo, bakante ka ng ${when}, hanggang ${nextUp.title} ng ${fmtTime(nextUp.start)}.`) : L(`Yes, you're free at ${when}, with nothing after it that day.`, `Oo, bakante ka ng ${when}, wala nang kasunod that day.`)
  }

  if (q.type === 'freeFor') {
    const need = q.hours * HOUR
    const days = q.day != null ? [q.day] : Array.from({ length: 7 }, (_, i) => startOfDay(now) + i * DAY)
    const fits: string[] = []
    for (const day of days) for (const g of freeGaps(day, Math.max(now, day), day + DAY, ev, d.prefs)) if (g.e - g.s >= need && fits.length < 3) fits.push(`${fmtDay(g.s).replace(/,.*/, '')} ${fmtTime(g.s)}–${fmtTime(g.e)}`)
    if (!fits.length) return L(`No ${fmtDur(q.hours)} free window ${q.day != null ? dayLabel(q.day, now) : 'this week'}.`, `Walang ${fmtDur(q.hours)} na bakante ${q.day != null ? dayLabel(q.day, now) : 'this week'}.`)
    return L(`You have ${fmtDur(q.hours)} free: ${fits.join('; ')}.`, `May ${fmtDur(q.hours)} kang bakante: ${fits.join('; ')}.`)
  }

  if (q.type === 'next' || q.type === 'now') {
    const current = ev.find((e) => e.kind !== 'deadline' && e.start <= now && e.end > now)
    const upcoming = ev.filter((e) => e.start > now)
    if (q.type === 'now') {
      if (current) return L(`Right now: ${current.title}, until ${fmtTime(current.end)}.${upcoming[0] ? ` Next is ${upcoming[0].title} at ${fmtTime(upcoming[0].start)}.` : ''}`, `Ngayon: ${current.title}, hanggang ${fmtTime(current.end)}.${upcoming[0] ? ` Susunod: ${upcoming[0].title} ng ${fmtTime(upcoming[0].start)}.` : ''}`)
      return upcoming[0] ? L(`Nothing right now. Next is ${upcoming[0].title} in ${until(upcoming[0].start - now)}.`, `Wala ngayon. Susunod: ${upcoming[0].title} in ${until(upcoming[0].start - now)}.`) : L('Nothing right now, and nothing coming up.', 'Wala ngayon, at wala pang susunod.')
    }
    const items = upcoming.slice(0, q.n)
    if (!items.length) return L('Nothing coming up on your calendar.', 'Wala ka pang susunod na naka-sched.')
    const line = (e: CalEvent) => `${e.title}, ${startOfDay(e.start) === startOfDay(now) ? fmtTime(e.start) : `${fmtDay(e.start).replace(/,.*/, '')} ${fmtTime(e.start)}`} (in ${until(e.start - now)})`
    if (q.n === 1) return L(`Next: ${line(items[0])}.`, `Susunod: ${line(items[0])}.`)
    return L(`Next up: ${items.map(line).join('; ')}.`, `Mga susunod: ${items.map(line).join('; ')}.`)
  }

  if (q.type === 'when' || q.type === 'countdown') {
    // The kind they named has to match: "Bio exam" is not "Bio 101" the class
    const named = /\b(exams?|quiz|test|midterms?|finals?|prelims?)\b/i.test(q.query) ? 'exam' : /\b(class|klase|lecture|lab)\b/i.test(q.query) ? 'class' : /\b(shift|duty)\b/i.test(q.query) ? 'shift' : /\b(paper|essay|report|project|submission|assignment|requirement|deadline)\b/i.test(q.query) ? 'assignment' : null
    const fitsKind = (kind: string) => !named || kind === named || (named === 'assignment' && (kind === 'deadline' || kind === 'assignment'))
    const want = words(q.query).filter((w) => !/^(exams?|quiz|test|class|klase|shift|paper|submission|deadline|requirement)$/.test(w) || words(q.query).length === 1)
    if (!want.length) return L('Which one? Tell me its name.', 'Alin? Sabihin mo ang pangalan.')
    const score = (title: string) => words(title).filter((w) => want.includes(w)).length
    const evs = ev.filter((e) => e.end > now && score(e.title) > 0 && fitsKind(e.kind)).map((e) => ({ title: e.title, at: e.start, kind: e.kind as string, s: score(e.title), taskId: e.taskId }))
    const tks = datedTasks(d.tasks).filter((t) => t.due > now && score(t.title) > 0 && fitsKind(t.kind)).map((t) => ({ title: t.title, at: t.due, kind: t.kind as string, s: score(t.title) + 0.5, taskId: t.id }))
    // The best name match, soonest first; the exam itself over its own review blocks
    const best = [...evs.filter((e) => e.kind !== 'work'), ...tks, ...evs.filter((e) => e.kind === 'work')].sort((a, b) => b.s - a.s || a.at - b.at)[0]
    if (!best) return L(`I don't see "${q.query}" on your calendar. Want to add it?`, `Wala akong nakitang "${q.query}" sa calendar mo. I-add natin?`)
    const whenText = `${fmtDay(best.at)} at ${fmtTime(best.at)}`
    const task = d.tasks.find((t) => t.id === best.taskId)
    const planned = task ? ev.filter((e) => e.taskId === task.id && e.kind === 'work' && e.start > now).length : 0
    const progress = !task ? '' : task.doneHours > 0 ? ` You've studied ${fmtDur(task.doneHours)} of ${fmtDur(task.hours)} for it.` : ` No study done for it yet (${fmtDur(task.hours)} needed${planned ? `, ${planned} session${planned > 1 ? 's' : ''} planned` : ', none planned yet'}).`
    const progressTl = !task ? '' : task.doneHours > 0 ? ` Nakapag-aral ka na ng ${fmtDur(task.doneHours)} sa ${fmtDur(task.hours)}.` : ` Wala ka pang naaral para dito (${fmtDur(task.hours)} ang kailangan${planned ? `, ${planned} session naka-plan` : ', wala pang naka-plan'}).`
    if (q.type === 'when') return L(`${best.title} is ${whenText}, in ${until(best.at - now)}.${progress}`, `Ang ${best.title} ay ${whenText}, in ${until(best.at - now)}.${progressTl}`)
    return L(`${until(best.at - now)} left before ${best.title} (${whenText}).${progress}`, `${until(best.at - now)} na lang bago ang ${best.title} (${whenText}).${progressTl}`)
  }

  if (q.type === 'insights') {
    const found = weekInsights(d.events, d.tasks, now, d.prefs).slice(0, 3)
    if (!found.length) return L('Your week looks balanced: breaks and meals fit, nothing runs late, and your exams have study time planned.', 'Maayos ang linggo mo: may break at kain, walang sobrang late, at may naka-plan na aral para sa exams.')
    return found.map((i) => (tl ? i.textTl : i.text)).join(' ')
  }

  if (q.type === 'due') {
    const end = startOfDay(now) + q.days * DAY
    const due = datedTasks(d.tasks).filter((t) => t.due > now && t.due < end).sort((a, b) => a.due - b.due)
    const label = q.days === 1 ? 'today' : q.days === 14 ? 'in the next two weeks' : 'this week'
    if (!due.length) return L(`Nothing due ${label}.`, `Walang due ${label}.`)
    const items = due.map((t) => `${t.title} (${fmtDay(t.due).replace(/,.*/, '')} ${fmtTime(t.due)}, in ${until(t.due - now)})`)
    return L(`Due ${label}: ${list(items)}. Closest is ${due[0].title}.`, `Due ${label}: ${list(items)}. Pinakamalapit: ${due[0].title}.`)
  }

  // Week: hours booked per day, the heaviest, and what's free
  const ws = startOfWeek(now) + q.offset * 7 * DAY
  const days = Array.from({ length: 7 }, (_, i) => ws + i * DAY)
  const hours = days.map((day) => ev.filter((e) => startOfDay(e.start) === day && e.kind !== 'deadline').reduce((a, e) => a + (e.end - e.start), 0) / HOUR)
  const total = hours.reduce((a, h) => a + h, 0)
  if (!total) return L(`Your ${q.offset ? 'next' : ''} week is wide open.`.replace('  ', ' '), 'Bakante ang buong linggo mo.')
  const top = hours.indexOf(Math.max(...hours))
  const light = days.filter((day, i) => hours[i] === 0 && day >= startOfDay(now)).map((day) => fmtDay(day).replace(/,.*/, ''))
  return L(
    `${fmtDur(total)} booked ${q.offset ? 'next week' : 'this week'}. Heaviest is ${fmtDay(days[top]).replace(/,.*/, '')} (${fmtDur(hours[top])}).${light.length ? ` Free days: ${light.join(', ')}.` : ''}`,
    `${fmtDur(total)} ang naka-book ${q.offset ? 'next week' : 'this week'}. Pinaka-busy: ${fmtDay(days[top]).replace(/,.*/, '')} (${fmtDur(hours[top])}).${light.length ? ` Free days: ${light.join(', ')}.` : ''}`,
  )
}
