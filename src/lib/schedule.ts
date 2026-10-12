// Greedy, explainable slot finder. Never writes to the calendar — it only proposes.
import { addDays, at, fmtHours, fmtTime, HOUR, MIN, startOfDay, startOfWeek, uid, type CalEvent, type Task } from './core'

export type Energy = 'morning' | 'afternoon' | 'evening'
const DAY_START = 7
const DAY_END = 23 // quiet hours after this
const SEARCH_FROM: Record<Energy, number[]> = {
  morning: [7, 12, 17],
  afternoon: [13, 17, 7],
  evening: [18, 13, 7],
}

/** Things the user told Pal once and expects it to remember ("no studying after 9pm", "keep Sundays free"). */
export interface Prefs {
  latestHour?: number
  blockedDays?: number[] // 0=Sun…6=Sat
}

export function freeGaps(dayStart: number, from: number, to: number, busy: CalEvent[], prefs: Prefs = {}) {
  if (prefs.blockedDays?.includes(new Date(dayStart).getDay())) return []
  const lo = Math.max(from, at(dayStart, DAY_START))
  const hi = Math.min(to, at(dayStart, Math.min(DAY_END, prefs.latestHour ?? DAY_END)))
  if (hi - lo < 30 * MIN) return []
  const blocks = busy
    .filter((e) => e.kind !== 'deadline' && e.end > lo && e.start < hi)
    .map((e) => ({ s: e.start, e: e.end + (e.kind === 'commute' || e.kind === 'shift' ? 15 * MIN : 0) }))
    .sort((a, b) => a.s - b.s)
  const gaps: { s: number; e: number }[] = []
  let cur = lo
  for (const b of blocks) {
    if (b.s > cur) gaps.push({ s: cur, e: b.s })
    cur = Math.max(cur, b.e)
  }
  if (hi > cur) gaps.push({ s: cur, e: hi })
  return gaps.filter((g) => g.e - g.s >= 45 * MIN)
}

export interface Proposal {
  blocks: CalEvent[]
  shortfall: number
  freeHours: number
  why: string
}

/** perDay: "study every day before the 17th" fills each day up to that many hours instead of spreading thin. */
export function propose(task: Task, hoursNeeded: number, events: CalEvent[], now: number, energy: Energy = 'afternoon', prefs: Prefs = {}, perDay?: number): Proposal {
  const busy = events.filter((e) => e.status !== 'done' && e.status !== 'missed')
  const startAt = Math.ceil(now / (15 * MIN)) * (15 * MIN)
  const days: number[] = []
  for (let d = startOfDay(startAt); d <= task.due; d = addDays(d, 1)) days.push(d)
  // Exams: leave the night before for a light review, not a cram.
  const perBlock = task.kind === 'exam' ? 1.5 : 1.25
  // "Review: Prelims", so a study block never looks like the exam itself moved
  const title = task.kind === 'exam' ? `Review: ${task.title}` : task.title
  let remaining = Math.round(hoursNeeded * 4) / 4
  const out: CalEvent[] = []
  let freeHours = 0
  const placedOn = (d: number) => out.filter((b) => startOfDay(b.start) === d)

  for (const pass of perDay ? [1] : [1, 2]) {
    for (const d of days) {
      if (remaining <= 0) break
      if (!perDay && placedOn(d).length >= pass) continue
      for (let first = true; ; first = false) {
        const room = perDay ? perDay - placedOn(d).reduce((a, b) => a + (b.end - b.start) / HOUR, 0) : Infinity
        // 15-min break after each placed block, so two blocks never run back to back
        const gaps = freeGaps(d, startAt, task.due, [...busy, ...out.map((b) => ({ ...b, end: b.end + 15 * MIN }))], prefs)
        if (pass === 1 && first) freeHours += gaps.reduce((a, g) => a + (g.e - g.s) / HOUR, 0)
        let slot: { s: number; e: number } | null = null
        for (const h of SEARCH_FROM[energy]) {
          const g = gaps.find((g) => g.e - Math.max(g.s, at(d, h)) >= 45 * MIN)
          if (g) {
            slot = { s: Math.max(g.s, at(d, h)), e: g.e }
            break
          }
        }
        if (!slot) break
        const s = slot.s
        // A last sliver under 30 min still gets a short block, instead of a "15m won't fit" warning on an open week
        const len = Math.min(perBlock, Math.max(remaining, 0.5), room, (slot.e - s) / HOUR)
        if (len < 0.5) break
        out.push({
          id: uid(), title, kind: 'work', start: s, end: s + Math.round(len * 4) * 15 * MIN,
          status: 'proposed', taskId: task.id,
        })
        remaining -= Math.round(len * 4) / 4
        if (!perDay || remaining <= 0) break
      }
    }
  }

  out.sort((a, b) => a.start - b.start)
  out.forEach((b, i) => (b.seg = `${i + 1}/${out.length}`))
  const spread = new Set(out.map((b) => startOfDay(b.start))).size
  const hasShift = busy.some((e) => e.kind === 'shift' && e.start < task.due && e.end > now)
  const why = out.length
    ? `${perDay ? `Up to ${fmtHours(perDay)} a day until the deadline, in sessions of at most ${perBlock}h with a break between` : `Spread over ${spread} day${spread > 1 ? 's' : ''} so no session runs longer than ${perBlock}h`}, placed around your classes${hasShift ? ' and shifts' : ''}, with a 15-min buffer after commutes. Nothing after ${fmtTime(at(startOfDay(now), Math.min(DAY_END, prefs.latestHour ?? DAY_END)))}${prefs.blockedDays?.length ? ', and your rest days stay free' : ''}.`
    : 'There are no free 45-minute windows left before the deadline.'
  out.forEach((b) => (b.why = why))
  return { blocks: out, shortfall: Math.max(0, Math.round(remaining * 4) / 4), freeHours: Math.round(freeHours * 2) / 2, why }
}

type Slot = { start: number; end: number }
/** Earliest hour Pal suggests moving something to (a 4:30am meeting can still go to 5:15am) */
const EARLIEST_ALT = 5

/**
 * What a new slot runs into: planned events of any kind, except deadlines and a task's study blocks
 * (those get new times when it's added). skipId: the event being moved.
 */
export function clashes(slots: Slot[], events: CalEvent[], skipId?: string) {
  return events
    .filter((e) => e.status === 'planned' && e.kind !== 'deadline' && !(e.kind === 'work' && e.taskId) && e.id !== skipId && slots.some((s) => e.start < s.end && e.end > s.start))
    .sort((a, b) => a.start - b.start)
}

/**
 * An exam at 4–6pm on top of "Bus home 5–5:45pm": a commute can move, the exam can't. The ride keeps its side:
 * one that starts during the new slot goes after it (the first free time, up to 3 hours later, e.g. after a 6pm
 * gym), one that starts before it goes earlier. Never across the new slot: "Bus home" before the exam is no help.
 * Null unless the only thing in the way is one commute, or nothing fits that day.
 */
export function moveAside(slot: Slot, hit: CalEvent[], events: CalEvent[], now: number): { event: CalEvent; to: Slot } | null {
  if (hit.length !== 1 || hit[0].kind !== 'commute') return null
  const e = hit[0]
  const len = e.end - e.start
  const later = e.start >= slot.start
  const taken = [...events, { id: '', title: '', kind: 'protected', status: 'planned', ...slot } as CalEvent]
  for (let k = 0; k <= 12; k++) {
    const s = later ? { start: slot.end + k * 15 * MIN, end: slot.end + k * 15 * MIN + len } : { start: slot.start - len - k * 15 * MIN, end: slot.start - k * 15 * MIN }
    if (startOfDay(s.start) !== startOfDay(e.start) || s.start < now || s.end > at(startOfDay(e.start), DAY_END)) break
    if (!clashes([s], taken, e.id).length) return { event: e, to: s }
  }
  return null
}

/**
 * The closest time, earlier or later the same day, where every slot fits clear of everything planned,
 * with the 15-min buffer after a commute or shift (as in freeGaps). Never in the past, before 5am or after 11pm.
 * Repeats move together. Null when nothing fits that day.
 */
export function nearestFree(slots: Slot[], events: CalEvent[], now: number, skipId?: string): Slot | null {
  if (!slots.length) return null
  const blocks = events
    .filter((e) => e.status === 'planned' && e.kind !== 'deadline' && e.id !== skipId)
    .map((e) => ({ s: e.start, e: e.end + (e.kind === 'commute' || e.kind === 'shift' ? 15 * MIN : 0) }))
  const fits = (d: number) => slots.every(({ start, end }) => {
    const s = start + d, e = end + d, day = startOfDay(start)
    return s >= Math.max(now, at(day, EARLIEST_ALT)) && e <= Math.max(at(day, DAY_END), end) && !blocks.some((b) => b.s < e && b.e > s)
  })
  // 15-min steps out from the asked time; a tie goes to the later one
  for (let k = 1; k <= 24 * 4; k++) for (const d of [k * 15 * MIN, -k * 15 * MIN]) if (fits(d)) return { start: slots[0].start + d, end: slots[0].end + d }
  return null
}

/** Weekly repeats of a time slot, from this week forward: 8 weeks, or through the `until` day. days: 0=Sun…6=Sat. */
export function occurrences(start: number, end: number, days: number[], now: number, until?: number, weeks = 8) {
  const s = new Date(start), dur = end - start
  const ws = startOfWeek(now), today = startOfDay(now)
  const out: { start: number; end: number }[] = []
  for (let w = 0; w < weeks; w++)
    for (const d of [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))) {
      const day = addDays(ws, w * 7 + ((d + 6) % 7))
      if (day < today || (until != null && day > startOfDay(until))) continue
      const t = new Date(day)
      t.setHours(s.getHours(), s.getMinutes(), 0, 0)
      out.push({ start: t.getTime(), end: t.getTime() + dur })
    }
  return out
}
