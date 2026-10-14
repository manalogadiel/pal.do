import { DAY, uid, type CalEvent } from './core'

export interface ClassRow {
  id: string
  title: string
  days: number[]
  startTime: string
  endTime: string
  room: string
  instructor: string
  sourceText: string
  page?: number
  issues: string[]
  selected: boolean
}
export interface ClassDraft {
  fileId: string
  classes: ClassRow[]
  startDate: string
  endDate: string
  timezone: string
}
export const CLASS_TIMEZONE = 'Asia/Manila'
const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const dateValue = (s: string) => {
  const t = Date.parse(s + 'T00:00:00Z')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== s) throw new Error('Choose valid start and end dates.')
  return t
}
export function rowIssues(row: ClassRow): string[] {
  return [
    ...row.issues,
    ...(!row.title.trim() ? ['Subject title is required.'] : []),
    ...(!row.days.length || row.days.some(d => !Number.isInteger(d) || d < 0 || d > 6) ? ['Select the weekdays.'] : []),
    ...(!clock.test(row.startTime) || !clock.test(row.endTime) ? ['Correct the start and end times, including AM/PM.'] : row.endTime <= row.startTime ? ['End time must be after start time; overnight classes are not supported.'] : []),
  ]
}
export function normalizeExtractedClasses(value: unknown): ClassRow[] {
  if (!Array.isArray(value) || value.length > 64) throw new Error('Invalid schedule response. Retry or enter classes manually.')
  return value.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid class in schedule response.')
    const x = item as Record<string, unknown>
    const str = (key: string) => typeof x[key] === 'string' ? (x[key] as string).trim() : ''
    const issues = Array.isArray(x.issues) ? x.issues.filter((s): s is string => typeof s === 'string').map(s => s.slice(0, 500)) : []
    const days = Array.isArray(x.days) ? [...new Set(x.days.filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))] : []
    if (Array.isArray(x.days) && days.length !== new Set(x.days).size) issues.push('Correct the weekday labels.')
    const row: ClassRow = { id: uid(), title: str('title'), days, startTime: str('startTime'), endTime: str('endTime'), room: str('room'), instructor: str('instructor'), sourceText: str('sourceText'), issues, selected: false,
      ...(Number.isInteger(x.page) && (x.page as number) > 0 ? { page: x.page as number } : {}) }
    row.selected = rowIssues(row).length === 0
    return row
  })
}
export function defaultClassDateRange(now = Date.now(), timezone = CLASS_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (key: string) => parts.find(p => p.type === key)!.value
  const startDate = `${get('year')}-${get('month')}-${get('day')}`
  return { startDate, endDate: new Date(dateValue(startDate) + 55 * DAY).toISOString().slice(0, 10) }
}
// Convert a wall clock in the calendar's timezone, independently of the host's timezone.
function zonedTime(date: string, time: string, timezone: string): number {
  const target = Date.parse(`${date}T${time}:00Z`)
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
  let result = target
  for (let i = 0; i < 3; i++) {
    const p = formatter.formatToParts(result)
    const get = (k: string) => p.find(v => v.type === k)!.value
    const wall = Date.parse(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}Z`)
    const difference = target - wall
    if (!difference) return result
    result += difference
  }
  throw new Error('This time does not exist in the calendar timezone. Correct it before adding.')
}
export function expandClassSchedule(draft: ClassDraft, now = Date.now()): CalEvent[] {
  const start = dateValue(draft.startDate), end = dateValue(draft.endDate)
  if (end < start || end - start > 366 * DAY) throw new Error('Choose an end date after the start, within one year.')
  const selected = draft.classes.filter(row => row.selected)
  for (const row of selected) {
    const issues = rowIssues(row)
    if (issues.length) throw new Error(issues.join(' '))
  }
  const events: CalEvent[] = []
  for (let day = start; day <= end; day += DAY) {
    const date = new Date(day).toISOString().slice(0, 10), weekday = new Date(day).getUTCDay()
    for (const row of selected) {
      if (!row.days.includes(weekday)) continue
      const from = zonedTime(date, row.startTime, draft.timezone), to = zonedTime(date, row.endTime, draft.timezone)
      if (from <= now) continue
      events.push({ id: uid(), title: row.title.trim(), kind: 'class', status: 'planned', start: from, end: to,
        note: [row.room && `Room: ${row.room}`, row.instructor && `Instructor: ${row.instructor}`].filter(Boolean).join('\n') })
    }
  }
  return events
}
export function reviewClassImport(draft: ClassDraft, calendar: CalEvent[], now = Date.now()) {
  const key = (e: CalEvent) => `${e.title.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()}|${e.start}|${e.end}`
  const seen = new Set(calendar.map(key))
  const events: CalEvent[] = [], conflicts: { incoming: CalEvent; existing: CalEvent }[] = []
  let duplicates = 0
  for (const e of expandClassSchedule(draft, now)) {
    if (seen.has(key(e))) { duplicates++; continue }
    seen.add(key(e))
    for (const existing of [...calendar, ...events]) {
      if (existing.start < e.end && existing.end > e.start) conflicts.push({ incoming: e, existing })
    }
    events.push(e)
  }
  return { events, duplicates, conflicts }
}
