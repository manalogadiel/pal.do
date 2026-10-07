// Greedy, explainable slot finder. Never writes to the calendar — it only proposes.
import { addDays, at, HOUR, MIN, startOfDay, uid, type CalEvent, type Task } from './core'

export type Energy = 'morning' | 'afternoon' | 'evening'
const DAY_START = 7
const DAY_END = 23 // quiet hours after this
const SEARCH_FROM: Record<Energy, number[]> = {
  morning: [7, 12, 17],
  afternoon: [13, 17, 7],
  evening: [18, 13, 7],
}

function freeGaps(dayStart: number, from: number, to: number, busy: CalEvent[]) {
  const lo = Math.max(from, at(dayStart, DAY_START))
  const hi = Math.min(to, at(dayStart, DAY_END))
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

export function propose(task: Task, hoursNeeded: number, events: CalEvent[], now: number, energy: Energy = 'afternoon'): Proposal {
  const busy = events.filter((e) => e.status !== 'done' && e.status !== 'missed')
  const startAt = Math.ceil(now / (15 * MIN)) * (15 * MIN)
  const days: number[] = []
  for (let d = startOfDay(startAt); d <= task.due; d = addDays(d, 1)) days.push(d)
  // Exams: leave the night before for a light review, not a cram.
  const perBlock = task.kind === 'exam' ? 1.5 : 1.25
  let remaining = Math.round(hoursNeeded * 4) / 4
  const out: CalEvent[] = []
  let freeHours = 0

  for (const pass of [1, 2]) {
    for (const d of days) {
      if (remaining <= 0) break
      const placedToday = out.filter((b) => startOfDay(b.start) === d).length
      if (placedToday >= pass) continue
      const gaps = freeGaps(d, startAt, task.due, [...busy, ...out])
      if (pass === 1) freeHours += gaps.reduce((a, g) => a + (g.e - g.s) / HOUR, 0)
      let slot: { s: number; e: number } | null = null
      for (const h of SEARCH_FROM[energy]) {
        const g = gaps.find((g) => g.e - Math.max(g.s, at(d, h)) >= 45 * MIN)
        if (g) {
          slot = { s: Math.max(g.s, at(d, h)), e: g.e }
          break
        }
      }
      if (!slot) continue
      const s = slot.s
      const len = Math.min(perBlock, remaining, (slot.e - s) / HOUR)
      if (len < 0.5) continue
      out.push({
        id: uid(), title: task.title, kind: 'work', start: s, end: s + Math.round(len * 4) * 15 * MIN,
        status: 'proposed', taskId: task.id,
      })
      remaining -= Math.round(len * 4) / 4
    }
  }

  out.sort((a, b) => a.start - b.start)
  out.forEach((b, i) => (b.seg = `${i + 1}/${out.length}`))
  const spread = new Set(out.map((b) => startOfDay(b.start))).size
  const hasShift = busy.some((e) => e.kind === 'shift' && e.start < task.due && e.end > now)
  const why = out.length
    ? `Spread over ${spread} day${spread > 1 ? 's' : ''} so no session runs longer than ${perBlock}h, placed around your classes${hasShift ? ' and shifts' : ''}, with a 15-min buffer after commutes. Nothing after 11pm.`
    : 'There are no free 45-minute windows left before the deadline.'
  out.forEach((b) => (b.why = why))
  return { blocks: out, shortfall: Math.max(0, Math.round(remaining * 4) / 4), freeHours: Math.round(freeHours * 2) / 2, why }
}
