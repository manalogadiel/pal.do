import { at, MIN, startOfDay, type CalEvent, type Task } from './core'
import type { Prefs } from './schedule'

/** A suggestion for right now; never writes a task, calendar block, or session. */
export function bestNextStep(now: number, events: CalEvent[], tasks: Task[], prefs: Prefs = {}) {
  const day = startOfDay(now)
  const stop = at(day, Math.min(23, prefs.latestHour ?? 23))
  if (now < at(day, 7) || now >= stop || prefs.blockedDays?.includes(new Date(now).getDay())) return null
  const busy = events.filter(e => e.kind !== 'deadline' && e.status !== 'proposed' && e.status !== 'missed')
  if (busy.some(e => e.start <= now && e.end + (['commute','shift'].includes(e.kind) ? 15 * MIN : 0) > now)) return null
  const next = busy.filter(e => e.start > now && e.start < stop).sort((a,b) => a.start-b.start)[0]
  const availableMinutes = Math.floor(((next?.start ?? stop) - now) / MIN)
  if (availableMinutes < 15) return null
  const task = tasks.filter(t => t.hours > t.doneHours && Number.isFinite(t.due) && Math.min(availableMinutes, (t.hours-t.doneHours)*60, (t.due-now)/MIN) >= 15).sort((a,b) => a.due-b.due || a.id.localeCompare(b.id))[0]
  if (!task) return null
  const minutes = Math.floor(Math.min(25, availableMinutes, (task.hours-task.doneHours)*60, (task.due-now)/MIN))
  return { task, next, minutes, availableMinutes }
}
