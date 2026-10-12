import { at, HOUR, startOfDay, type CalEvent, type Kind, type Task } from './core'
import { clockTime, eventKind, extractTitle, isRelative, namedDay, parseHours, parseRange, parseWhen, taskKind } from './parse'

export interface ConversationFocus {
  intent: 'event' | 'study' | 'remove' | 'none'
  title?: string
  kind?: Kind
  day?: number
  start?: number
  end?: number
  awaitingEnd?: boolean
  hours?: number
  perDay?: number
  due?: number
  notBefore?: number
  replace?: boolean
  rejected: string[]
}
export type Directive = 'greeting' | 'continue' | 'newRequest' | 'correct' | 'decline' | 'clarify'
export const emptyFocus = (): ConversationFocus => ({ intent: 'none', rejected: [] })
export const isGreeting = (text: string) => /^\s*(hi|hello|hey|yo|uy|oy|hoy|kamusta|kumusta)(?:\s+(?:po|rei|diel|jhyvie|jhivie|jhy|jv|jaypee|jp|pal|bosing|boss))?[.!?\s]*$/i.test(text)
const NEW = /\b(new (?:one|event|schedule|plan)|another (?:event|schedule)|bagong (?:event|schedule|sched|plano))\b/i
const REJECT_KIND = /\b(?:not|hindi|di)\s+(?:an?\s+)?(exam|quiz|class|meeting|seminar)\b/i
const DECLINE = /^\s*(no+|nope|nah|hindi|wag(?: na)?|huwag(?: na)?|not now|cancel|never ?mind)[.!?\s]*$/i
const STUDY = /\b(study|review|aral\w*|magreview|study sessions?)\b/i
const REMOVE = /\b(remove|delete|remoce|tanggal\w*|alisin|bura\w*)\b/i

export function updateConversationFocus(previous: ConversationFocus, userText: string, now: number): { focus: ConversationFocus; directive: Directive } {
  if (isGreeting(userText)) return { focus: previous, directive: 'greeting' }
  if (NEW.test(userText)) return { focus: { ...emptyFocus(), intent: 'event' }, directive: 'newRequest' }
  const rejected = userText.match(REJECT_KIND)?.[1]?.toLowerCase()
  if (rejected) {
    previous = { ...emptyFocus(), intent: 'event', rejected: [...new Set([...previous.rejected, rejected])] }
    userText = userText.replace(REJECT_KIND, '').replace(/^\s*(?:no|hindi)\b\s*[,;]?/i, '').replace(/^[\s,;.!?]*(?:(?:it is|it's|instead|but)\s+)?/i, '').trim()
    if (!userText) return { focus: previous, directive: 'correct' }
  }
  if (DECLINE.test(userText)) return { focus: emptyFocus(), directive: 'decline' }
  if (REMOVE.test(userText)) return { focus: { ...previous, intent: 'remove' }, directive: 'continue' }
  if (STUDY.test(userText) || previous.intent === 'study') {
    const hours = !parseRange(userText, now) && !clockTime(userText) ? parseHours(userText) : null
    const studyText = userText.replace(/\b(?:(?:can|could|would) you|help me|i (?:want|would like) to|i'?d like to)\b/gi, '').replace(/\b(?:\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|oras)|every day|araw-araw)\b/gi, '').replace(/\b(then|let'?s|lets|remake|replan|study|studying|review|aral\w*|sessions?|find|me|mag|oo|ano|magandang|oras|everyday|daily|basta|dapat|dpat|bago|before|until|exam|hours?|hrs?)\b/gi, '')
    const subject = STUDY.test(userText) ? extractTitle(studyText, '') : ''
    const kind = eventKind(userText)
    if (!kind && (STUDY.test(userText) || !/\b(i have|may|meron|new)\b/i.test(userText))) {
      const changedSubject = !!subject && subjectKey(subject) !== subjectKey(previous.title ?? '')
      const base = changedSubject ? emptyFocus() : previous
      const focus: ConversationFocus = { ...base, intent: 'study', title: subject || previous.title, due: base.due ?? (base.kind === 'exam' ? base.start : undefined), ...(hours && hours > 0 ? { hours } : {}), replace: base.replace || /\b(remake|replan|resched\w*|adjust|ulit|baguhin)\b/i.test(userText) }
      if (hours && /\b(every ?day|daily|araw-araw|each day)\b/i.test(userText)) focus.perDay = hours
      else if (hours && /\b(total|altogether|in all|lang|only)\b/i.test(userText)) delete focus.perDay
      const when = parseWhen(userText, now)
      const deadline = /\b(exam|deadline|due|before|until|bago|by)\b/i.test(userText) && !!when
      if (deadline) {
        focus.due = when.t
        delete focus.notBefore
      } else if (when) focus.notBefore = when.hadTime ? when.t : startOfDay(when.t)
      return { focus, directive: 'continue' }
    }
  }
  const kind = taskKind(userText) === 'exam' ? 'exam' : eventKind(userText) ?? (/\b(meeting|birthday|appointment|party)\b/i.test(userText) ? 'protected' : null)
  const day = namedDay(userText, now) ?? (/\blater\b/i.test(userText) && !isRelative(userText) ? startOfDay(now) : undefined)
  const range = parseRange(userText, now)
  const when = parseWhen(userText, now)
  const hasTime = !!(range || clockTime(userText) || (isRelative(userText) && when?.hadTime))
  if (previous.intent === 'remove' && !/\b(add|create|new|schedule|ilagay|lagay)\b/i.test(userText)) return { focus: previous, directive: 'continue' }
  const explicitlyNamed = !!kind && !/\b(make it|change it|move it|gawin|ilipat)\b/i.test(userText)
  let focus = { ...previous, rejected: [...previous.rejected] }
  if (explicitlyNamed) {
    const title = extractTitle(userText.replace(/\blater\b/gi, ''), '')
    if (title) {
      const same = title.toLowerCase() === previous.title?.toLowerCase()
      focus = { ...emptyFocus(), intent: 'event', title, kind, rejected: previous.rejected, ...(same ? { day: previous.day, start: previous.start, end: previous.end } : {}) }
    }
  } else if (previous.intent === 'event' && /\b(i have|may|meron|schedule|add)\b/i.test(userText) && !hasTime) {
    const title = extractTitle(userText.replace(/\blater\b/gi, ''), '')
    if (title) focus = { ...emptyFocus(), intent: 'event', title, kind: kind ?? 'protected' }
  }
  if (focus.intent !== 'event') return { focus, directive: 'continue' }
  if (day != null) {
    const delta = day - (focus.day ?? (focus.start ? startOfDay(focus.start) : day))
    focus.day = day
    if (focus.start != null) focus.start += delta
    if (focus.end != null) focus.end += delta
  }
  if (hasTime) {
    if (/^(exam|quiz|meeting|event)$/i.test(focus.title ?? '')) {
      const title = extractTitle(userText.replace(/\b(no|make|it|change|instead|dapat)\b/gi, ''), '')
      if (title && !/^(am|pm)$/i.test(title)) focus.title = focus.kind === 'exam' && !/\b(exam|quiz)\b/i.test(title) ? `${title} exam` : title
    }
    const base = focus.day ?? startOfDay(now)
    if (range) {
      focus.start = base + range.start - startOfDay(range.start)
      focus.end = base + range.end - startOfDay(range.start)
      delete focus.awaitingEnd
    } else if (isRelative(userText) && when) {
      const length = focus.end && focus.start ? focus.end - focus.start : HOUR
      focus.start = when.t
      focus.end = when.t + length
    } else {
      const clock = clockTime(userText)!
      const length = focus.end && focus.start ? focus.end - focus.start : HOUR
      const t = at(base, clock[0], clock[1])
      if (focus.kind === 'exam' && previous.awaitingEnd && previous.start != null && !/\b(no|hindi|instead|make|change|start)\b/i.test(userText)) {
        if (t > previous.start) { focus.end = t; delete focus.awaitingEnd }
      } else {
        focus.start = t
        focus.end = focus.kind === 'exam' ? undefined : t + length
        if (focus.kind === 'exam') focus.awaitingEnd = true
      }
    }
    focus.day = startOfDay(focus.start!)
  }
  return { focus, directive: hasTime && /\b(no|hindi|make|change|instead|dapat)\b/i.test(userText) ? 'correct' : 'continue' }
}

export function eventFromFocus(focus: ConversationFocus) {
  if (focus.intent !== 'event' || focus.awaitingEnd || !focus.title || focus.start == null || focus.end == null || focus.end <= focus.start) return null
  return { title: focus.title, kind: focus.kind ?? 'protected', start: focus.start, end: focus.end }
}

export function describeFocus(focus: ConversationFocus) {
  if (focus.intent === 'none') return ''
  return `CURRENT REQUEST (latest user corrections override older chat): ${JSON.stringify(focus)}. Missing fields are unknown, not permission to reuse another event. Rejected interpretations must not return.`
}

export function selectStudyGroup(text: string, events: CalEvent[], groups: string[][]): CalEvent[] | null {
  if (!REMOVE.test(text) && !/\b(apat|four|previous|old|dati|mga)\b/i.test(text)) return null
  const count = text.match(/\b(\d+)\b/)?.[1]
  const n = count ? Number(count) : /\b(apat|four)\b/i.test(text) ? 4 : undefined
  if (!n && !/\b(previous|old|dati|mga|sessions?|blocks?)\b/i.test(text)) return null
  const candidates = groups.map((ids) => ids.map((id) => events.find((e) => e.id === id && e.kind === 'work' && e.taskId && (e.status === 'proposed' || e.status === 'planned'))).filter((e): e is CalEvent => !!e))
    .filter((group) => group.length && (!n || group.length === n))
  const unique = candidates.filter((group, index) => candidates.findIndex((other) => other.map((e) => e.id).sort().join(',') === group.map((e) => e.id).sort().join(',')) === index)
  const named = text.toLowerCase().replace(/\b(remove|delete|remoce|the|those|these|them|from|previous|old|study|review|sessions?|blocks?|schedules?|schedule|exam|four|apat|ung|yung|mga|alisin|tanggalin|hindi|ang|ko|mo|ng|sa|na|yan|kasi|mali|naman)\b|\d+|[,.!?]/g, ' ').trim().split(/\s+/).filter((word) => word.length > 2)
  const matching = named.length ? unique.filter((group) => named.every((word) => group.some((e) => e.title.toLowerCase().includes(word)))) : unique
  return matching.length === 1 ? matching[0] : null
}

export function removePreviewedEvents(events: CalEvent[], targets: { id: string; title: string; start: number; end: number }[]) {
  if (!targets.length || targets.some((target) => !events.some((e) => e.id === target.id && e.title === target.title && e.start === target.start && e.end === target.end))) return null
  const ids = new Set(targets.map((e) => e.id))
  return events.filter((e) => !ids.has(e.id))
}

const subjectKey = (title: string) => title.toLowerCase().replace(/\b(review|study|exam|quiz|preparation|prep|sessions?|for|sa|ng)\b|[:!?]/g, ' ').replace(/\s+/g, ' ').trim()
export function resolveStudyRequest(focus: ConversationFocus, events: CalEvent[], tasks: Task[], now: number) {
  if (focus.intent !== 'study') return null
  const key = subjectKey(focus.title ?? '')
  const matches = (title: string) => { const other = subjectKey(title); return !!key && !!other && (key.includes(other) || other.includes(key)) }
  const exams = events.filter((e) => e.kind === 'exam' && e.status === 'planned' && e.start > now && (!key || matches(e.title)))
  const upcoming = tasks.filter((t) => t.due > now && (!key || matches(t.title)))
  if (!key && exams.length + upcoming.filter((t) => !exams.some((e) => e.taskId === t.id)).length !== 1) return null
  const exam = exams.sort((a, b) => a.start - b.start)[0]
  const task = upcoming.sort((a, b) => a.due - b.due)[0]
  const title = focus.title || exam?.title || task?.title
  const due = Math.min(...[focus.due, exam?.start, task?.due].filter((t): t is number => t != null && t > now))
  if (!title || !Number.isFinite(due)) return null
  return { title, due, hours: focus.hours, perDay: focus.perDay, task, exam, notBefore: focus.notBefore, replace: !!focus.replace }
}
