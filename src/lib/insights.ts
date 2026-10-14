import { datedTasks, isTaskDone } from './tasks'
// What a good secretary notices in a calendar: no study plan before an exam, short sleep, an overloaded day, hours
// with no break, no time to eat, late nights, cramming. Observations about the schedule only, never about how they
// feel (no "you seem stressed"), each with one concrete thing to try. The user decides.
import { at, DAY, fmtDay, fmtDur, fmtTime, HOUR, MIN, startOfDay, startOfWeek, type CalEvent, type Task } from './core'
import type { Prefs } from './schedule'

export type InsightKind = 'noPlan' | 'unaccepted' | 'shortSleep' | 'overloaded' | 'noBreak' | 'noMeal' | 'lateNight' | 'cramming'
export interface Insight {
  /** Stable per problem ("noBreak:<day>"), so a dismissed nudge isn't repeated */
  id: string
  kind: InsightKind
  day: number
  text: string
  textTl: string
  /** A message to send for the fix ("Plan Bio exam"), shown as a chip */
  chip?: string
}

/** Most worth saying first */
const ORDER: InsightKind[] = ['noPlan', 'unaccepted', 'shortSleep', 'overloaded', 'noBreak', 'noMeal', 'lateNight', 'cramming']

const short = (t: number) => fmtDay(t).replace(/,.*/, '')
/** Booked time that counts as busy (deadlines are a moment, not a block) */
const blocks = (events: CalEvent[]) => events.filter((e) => (e.status === 'planned' || e.status === 'done') && e.kind !== 'deadline').sort((a, b) => a.start - b.start)

function dayInsightsFor(day: number, ev: CalEvent[], now: number, prefs: Prefs): Insight[] {
  const out: Insight[] = []
  const today = ev.filter((e) => startOfDay(e.start) === day)
  if (!today.length) return out
  const booked = today.reduce((a, e) => a + (e.end - e.start), 0) / HOUR
  const d = short(day)

  // Overloaded: 9h+ on one day
  if (booked >= 9) out.push({ id: `overloaded:${day}`, kind: 'overloaded', day, text: `${d} has ${fmtDur(booked)} booked. Want to move something to a lighter day?`, textTl: `${fmtDur(booked)} ang naka-book sa ${d}. Ilipat natin ang isa sa mas maluwag na araw?` })

  // No break: 3.5h+ back-to-back (gaps under 15 min)
  // (at least two activities: one long shift or lab is what it is, not something to break up)
  let runStart = today[0].start, runEnd = today[0].end, parts = today[0].kind === 'commute' ? 0 : 1
  for (const e of [...today.slice(1), null]) {
    if (e && e.start - runEnd < 15 * MIN) { runEnd = Math.max(runEnd, e.end); if (e.kind !== 'commute') parts++; continue }
    if (runEnd - runStart >= 3.5 * HOUR && parts >= 2) {
      out.push({ id: `noBreak:${day}:${runStart}`, kind: 'noBreak', day, text: `${d} runs ${fmtTime(runStart)}–${fmtTime(runEnd)} with no break. A 15-minute pause in the middle would help.`, textTl: `Tuloy-tuloy ka sa ${d} mula ${fmtTime(runStart)} hanggang ${fmtTime(runEnd)}. Mag-15 minutes break ka sa gitna.` })
      break
    }
    if (e) { runStart = e.start; runEnd = e.end; parts = e.kind === 'commute' ? 0 : 1 }
  }

  // No meal window on a busy day: nothing free for 30 min around lunch (11:30–1:30) or dinner (6–8pm)
  if (booked >= 6) {
    const freeIn = (from: number, to: number) => {
      let cur = from
      for (const e of today) {
        if (e.end <= cur || e.start >= to) continue
        if (e.start - cur >= 30 * MIN) return true
        cur = Math.max(cur, e.end)
      }
      return to - cur >= 30 * MIN
    }
    const lunch = freeIn(at(day, 11, 30), at(day, 13, 30))
    const dinner = freeIn(at(day, 18), at(day, 20))
    if (!lunch || !dinner) {
      const meal = !lunch ? 'lunch' : 'dinner'
      const [from, to] = meal === 'lunch' ? [at(day, 11, 30), at(day, 13, 30)] : [at(day, 18), at(day, 20)]
      // A shift, class or exam over mealtime can't move: eat before it. Anything else: keep 30 minutes free
      const fixed = today.find((e) => e.start < to && e.end > from && (e.kind === 'shift' || e.kind === 'class' || e.kind === 'exam'))
      const mealTl = meal === 'lunch' ? 'tanghalian' : 'hapunan'
      out.push(fixed
        ? { id: `noMeal:${day}:${meal}`, kind: 'noMeal', day, text: `Your ${fixed.title} covers ${meal} on ${d}. Grab something before ${fmtTime(fixed.start)}.`, textTl: `Sakop ng ${fixed.title} ang ${mealTl} sa ${d}. Kumain ka bago mag-${fmtTime(fixed.start)}.` }
        : { id: `noMeal:${day}:${meal}`, kind: 'noMeal', day, text: `No time for ${meal} on ${d}. Want me to keep 30 minutes free for it?`, textTl: `Walang oras para sa ${mealTl} sa ${d}. Mag-reserve tayo ng 30 minutes?` })
    }
  }

  // Late night: anything ending after their "nothing after X" or 11pm
  const latest = at(day, prefs.latestHour ?? 23)
  const late = today.filter((e) => e.end > latest && e.kind !== 'commute').sort((a, b) => b.end - a.end)[0]
  if (late) out.push({ id: `lateNight:${day}`, kind: 'lateNight', day, text: `${late.title} on ${d} runs until ${fmtTime(late.end)}. Could it end earlier?`, textTl: `Ang ${late.title} sa ${d} ay hanggang ${fmtTime(late.end)}. Pwede bang mas maaga matapos?` })

  // Short sleep: under 7h between the last thing tonight and the first thing tomorrow
  const last = today.reduce((a, e) => (e.end > a.end ? e : a))
  const first = ev.find((e) => startOfDay(e.start) === day + DAY)
  if (first && last.end > at(day, 20) && first.start - last.end < 7 * HOUR && first.start > now)
    out.push({ id: `shortSleep:${day}`, kind: 'shortSleep', day, text: `Only ${fmtDur((first.start - last.end) / HOUR)} between ${last.title} (ends ${fmtTime(last.end)}) and ${first.title} (${short(first.start)} ${fmtTime(first.start)}). That's short for sleep.`, textTl: `${fmtDur((first.start - last.end) / HOUR)} lang mula ${last.title} (tapos ${fmtTime(last.end)}) hanggang ${first.title} (${short(first.start)} ${fmtTime(first.start)}). Kulang sa tulog yan.` })
  return out
}

/** Exams and deadlines: nothing planned yet, or nearly all of it crammed into the last two days */
function taskInsights(events: CalEvent[], tasks: Task[], now: number): Insight[] {
  const out: Insight[] = []
  for (const t of datedTasks(tasks).filter((t) => t.due > now && t.due - now < 7 * DAY && t.doneHours < t.hours)) {
    const study = events.filter((e) => e.taskId === t.id && e.kind === 'work' && (e.status === 'planned' || e.status === 'proposed') && e.end > now)
    const need = t.hours - t.doneHours
    if (!study.length) {
      out.push({ id: `noPlan:${t.id}`, kind: 'noPlan', day: startOfDay(t.due), text: `${t.title} is ${short(t.due)} ${fmtTime(t.due)} and there's no study time planned yet (${fmtDur(need)} needed). Want me to find some?`, textTl: `Ang ${t.title} ay sa ${short(t.due)} ${fmtTime(t.due)} at wala pang naka-plan na aral (${fmtDur(need)} kailangan). Hanapan kita ng oras?`, chip: `Plan ${t.title}` })
      continue
    }
    // Suggested but never accepted, and the first session is within a day: it isn't really on their calendar
    const accepted = study.filter((e) => e.status === 'planned')
    if (!accepted.length && study[0] && Math.min(...study.map((e) => e.start)) - now < DAY) {
      out.push({ id: `unaccepted:${t.id}`, kind: 'unaccepted', day: startOfDay(t.due), text: `Your study plan for ${t.title} is still just a suggestion, and the first session is soon. Accept it so it's really on your calendar?`, textTl: `Suggestion pa lang ang study plan mo para sa ${t.title}, at malapit na ang unang session. I-accept natin para nasa calendar mo talaga?`, chip: `Plan ${t.title}` })
      continue
    }
    const total = study.reduce((a, e) => a + (e.end - e.start), 0)
    const late = study.filter((e) => e.start > t.due - 2 * DAY).reduce((a, e) => a + (e.end - e.start), 0)
    if (study.length >= 3 && late / total >= 0.75)
      out.push({ id: `cramming:${t.id}`, kind: 'cramming', day: startOfDay(t.due), text: `Most of your ${t.title} study is in the last two days before it. Spreading it out sticks better. Want me to?`, textTl: `Halos lahat ng aral mo sa ${t.title} ay sa huling dalawang araw. Ikalat natin para mas tumatak?`, chip: `Replan ${t.title}` })
  }
  return out
}

const rank = (i: Insight) => ORDER.indexOf(i.kind)

/** What's worth saying about one day (after adding something to it, or in the morning brief) */
export function dayInsights(day: number, events: CalEvent[], tasks: Task[], now: number, prefs: Prefs = {}): Insight[] {
  const ev = blocks(events)
  return [...dayInsightsFor(startOfDay(day), ev, now, prefs), ...taskInsights(events, tasks, now).filter((i) => i.day >= startOfDay(day))].sort((a, b) => rank(a) - rank(b))
}

/** The rest of this week, most important first ("any bad habits?", "how's my week?") */
export function weekInsights(events: CalEvent[], tasks: Task[], now: number, prefs: Prefs = {}): Insight[] {
  const ev = blocks(events)
  const ws = startOfWeek(now)
  const days = Array.from({ length: 7 }, (_, i) => ws + i * DAY).filter((d) => d >= startOfDay(now))
  return [...taskInsights(events, tasks, now), ...days.flatMap((d) => dayInsightsFor(d, ev, now, prefs))].sort((a, b) => rank(a) - rank(b) || a.day - b.day)
}

/** New problems a change created: what's in `after` that wasn't in `before` */
export const newInsights = (before: Insight[], after: Insight[]) => after.filter((a) => !before.some((b) => b.id === a.id))
