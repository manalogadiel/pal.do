export const MIN = 60_000
export const HOUR = 3_600_000
export const DAY = 86_400_000

export type Kind = 'class' | 'shift' | 'exam' | 'work' | 'commute' | 'protected' | 'deadline'
export type Status = 'planned' | 'proposed' | 'done' | 'missed'
export type TaskKind = 'exam' | 'assignment' | 'task'
export type PalId = 'rei' | 'diel' | 'jhyvie' | 'jaypee'
export type PalState = 'idle' | 'listening' | 'talking' | 'sleeping' | 'alert' | 'alarmed' | 'shocked' | 'happy' | 'wave' | 'cheer'

export interface CalEvent {
  id: string
  title: string
  kind: Kind
  start: number
  end: number
  status: Status
  taskId?: string
  seg?: string
  why?: string
  transportSource?: 'user-trip' | 'routine'
  travel?: import('./travel').TravelDraft
  note?: string
}

export interface Task {
  id: string
  title: string
  kind: TaskKind
  due?: number
  hours: number
  doneHours: number
  notes?: string
  status?: 'pile' | 'doing' | 'done'
  estimatedMinutes?: number
  scheduled?: { eventId: string; start: number; end: number }
  folderId?: string
  createdAt?: number
  updatedAt?: number
  lastTouchedAt?: number
  completedAt?: number
}

export const uid = () => Math.random().toString(36).slice(2, 9)

export function startOfDay(t: number) {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
export function addDays(t: number, n: number) {
  const d = new Date(t)
  d.setDate(d.getDate() + n)
  return d.getTime()
}
export function startOfWeek(t: number) {
  const d = startOfDay(t)
  return addDays(d, -((new Date(d).getDay() + 6) % 7))
}
export function at(day: number, h: number, m = 0) {
  const d = new Date(day)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}
export function fmtTime(t: number) {
  const d = new Date(t)
  const h = d.getHours()
  const m = d.getMinutes()
  return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`
}
/** Explicit clock periods for chat replies and model facts; compact labels keep using fmtTime. */
export function fmtReplyTime(t: number) {
  return fmtTime(t).replace(/(am|pm)$/, period => ` ${period.toUpperCase()}`)
}
export function fmtDay(t: number) {
  return new Date(t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
export function fmtHours(h: number) {
  const r = Math.round(h * 4) / 4
  return r < 1 ? `${Math.round(r * 60)}m` : `${r}h`
}
/** "8h 15m": durations for prompts, so the model never says "8.25 hours" */
export function fmtDur(h: number) {
  const m = Math.round(h * 4) * 15
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`
}
export const hoursOf = (e: CalEvent) => (e.end - e.start) / HOUR

/** Demo week: classes, shifts, commute, a protected lunch, and one ongoing paper. */
export function seedWeek(now: number): { events: CalEvent[]; tasks: Task[] } {
  const ws = startOfWeek(now)
  const ev: CalEvent[] = []
  const add = (d: number, title: string, kind: Kind, sh: number, sm: number, eh: number, em: number) =>
    ev.push({ id: uid(), title, kind, start: at(addDays(ws, d), sh, sm), end: at(addDays(ws, d), eh, em), status: 'planned' })
  for (const d of [0, 2, 4]) add(d, 'Calc II', 'class', 9, 0, 10, 30)
  for (const d of [1, 3]) add(d, 'Bio 101', 'class', 10, 0, 12, 0)
  add(3, 'Chem lab', 'class', 13, 0, 16, 0)
  for (let d = 0; d < 5; d++) {
    add(d, 'Bus to campus', 'commute', 8, 0, 8, 45)
    if (d !== 2) add(d, 'Bus home', 'commute', d === 3 ? 16 : 17, 0, d === 3 ? 16 : 17, 45)
  }
  add(2, 'Café shift', 'shift', 18, 0, 22, 0)
  add(5, 'Café shift', 'shift', 13, 0, 19, 0)
  add(6, 'Family lunch', 'protected', 11, 0, 13, 30)

  const taskId = uid()
  const due = at(addDays(ws, 4), 23, 59)
  const b1 = { s: at(addDays(ws, 1), 19, 0), e: at(addDays(ws, 1), 20, 30) }
  const b2 = { s: at(addDays(ws, 3), 19, 0), e: at(addDays(ws, 3), 20, 30) }
  let doneHours = 0
  for (const [i, b] of [b1, b2].entries()) {
    const past = b.e <= now
    if (past) doneHours += 1.5
    ev.push({
      id: uid(), title: 'Rizal reflection paper', kind: 'work', start: b.s, end: b.e,
      status: past ? 'done' : 'planned', taskId, seg: `${i + 1}/2`,
      why: 'Evenings after class were free, and it leaves a day of buffer before Friday.',
    })
  }
  ev.push({ id: uid(), title: 'Rizal reflection paper', kind: 'deadline', start: due, end: due, status: 'planned', taskId })
  return { events: ev, tasks: [{ id: taskId, title: 'Rizal reflection paper', kind: 'assignment', due, hours: 3, doneHours }] }
}
