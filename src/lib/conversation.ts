import { datedTasks, isTaskDone } from './tasks'
import { at, fmtDay, fmtTime, HOUR, startOfDay, type CalEvent, type Kind, type Task } from './core'
import { clockTime, eventKind, extractTitle, isRelative, namedDay, parseHours, parseRange, parseWhen, suppliedEventTitle, taskKind } from './parse'

export interface ConversationFocus {
  intent: 'event' | 'study' | 'remove' | 'none'
  title?: string
  kind?: Kind
  day?: number
  start?: number
  end?: number
  awaitingEnd?: boolean
  /** A bare "exam"/"quiz": Pal asks the subject along with the time, and a short answer ("bio") fills it once */
  needsSubject?: boolean
  hours?: number
  perDay?: number
  due?: number
  notBefore?: number
  replace?: boolean
  rejected: string[]
}
/** question: they asked something ("do I have an exam tomorrow?"); it never starts or changes an event */
export type Directive = 'greeting' | 'continue' | 'newRequest' | 'correct' | 'decline' | 'clarify' | 'question'

/**
 * A question, not a request: "do I have an exam tomorrow?", "no, I'm asking if…", "may pasok ba ako bukas?".
 * "Can you add gym at 5?" is a request, and "5pm?" answering Pal's own question is an answer, so neither counts.
 */
export function isQuestion(text: string, previous?: ConversationFocus) {
  const t = text.trim()
  if (/\b(add|put|book|move|resched\w*|cancel|remove|delete|lagay|ilagay|ilipat|tanggal\w*|alisin|remind me|schedule (a|an|my|it|this|that)|make (a|an|me))\b/i.test(t)) return false
  if (previous?.intent === 'event' && (clockTime(t) || parseRange(t, Date.now())) && t.split(/\s+/).length <= 5) return false
  return /\?\s*$/.test(t) || /\b(asking (if|whether|kung)|tinatanong ko)\b/i.test(t)
    || /^\W*(?:no+[,.!]?\s+)?(do|does|did|am|is|are|was|were|will|would|can|could|what|when|where|which|who|how|why|ano|anong|kailan|saan|sino|bakit|ilang|meron ba|may .+ ba)\b/i.test(t)
}
export const emptyFocus = (): ConversationFocus => ({ intent: 'none', rejected: [] })
export const isGreeting = (text: string) => /^\s*(hi|hello|hey|yo|uy|oy|hoy|kamusta|kumusta)(?:\s+(?:po|rei|diel|jhyvie|jhivie|jhy|jv|jaypee|jp|pal|bosing|boss))?[.!?\s]*$/i.test(text)
/** Everyday lines with a day in them that aren't an activity: "see you tomorrow", "okay bukas na lang" */
const CHAT_LINE = /^\s*(see|i|i'?m|you|we|it|it'?s|that|this|thanks|thank|good|ok|okay|bye|maybe|sure|yes|yeah|no|nope|oo|sige|hindi|wala|tara|ayos|bahala|until|till|bukas na|next time)\b/i
const NEW = /\b(new (?:one|event|schedule|plan)|another (?:event|schedule)|bagong (?:event|schedule|sched|plano))\b|^\W*(?:(?:hi|hey|hello|uy|oy)\W+)?(?:(?:can|could|will) (?:you|u) |pls |please |pa-?)?(?:sched(?:ule)?|add|plan|lagay|ilagay)(?: (?:something|smth|sth|an event|me|for me|po|mo|ka))*\W*$/i
const REJECT_KIND = /\b(?:not|hindi|di)\s+(?:an?\s+)?(exam|quiz|class|meeting|seminar)\b/i
const DECLINE = /^\s*(no+|nope|nah|hindi|wag(?: na)?|huwag(?: na)?|not now|cancel|never ?mind)[.!?\s]*$/i
const STUDY = /\b(study|review|aral\w*|magreview|study sessions?)\b/i
const REMOVE = /\b(remove|delete|remoce|tanggal\w*|alisin|bura\w*)\b/i
/** A title that's only the kind: Pal still wants the subject */
const GENERIC = /^(exam|quiz|test|meeting|event)$/i
/** What speech-to-text writes for "starts" ("parts on 5pm"): never a subject */
const MISHEARD_STARTS = /\b(parts?|stars?|darts?|hearts?|arts?|smarts?|stats?|starch|sparks?)\b/gi
/** Short replies that aren't a subject when Pal asked for one */
const NOT_A_SUBJECT = /^\s*(ok(ay)?|oo|yes|yeah|no|hindi|wait|hmm+|sige|sure|thanks|thank you|skip|what|ha|huh|bakit|ano|why|idk|di ko alam)\b/i

export function updateConversationFocus(previous: ConversationFocus, userText: string, now: number): { focus: ConversationFocus; directive: Directive } {
  if (isGreeting(userText)) return { focus: previous, directive: 'greeting' }
  const suppliedTitle = suppliedEventTitle(userText)
  const question = isQuestion(userText, previous)
  // A question leaves the event being set up exactly as it was ("do I have an exam tomorrow" made one titled "Do exam")
  // "Can you schedule something for me?" is a request to add, with nothing named yet: Pal asks what
  if (!suppliedTitle && (!question || /^\s*(?:can|could|will) you\s+(?:schedule|plan)\b/i.test(userText)) && (NEW.test(userText) || /^\s*(?:i have (?:a |another )?(?:plan|event)|may (?:plano|plan) (?:ako|ko))(?:\s+(?:today|tomorrow|ngayon|bukas|mamaya))?[.!\s]*$/i.test(userText))) {
    const day = namedDay(userText, now)
    return { focus: { ...emptyFocus(), intent: 'event', ...(day != null ? { day } : {}) }, directive: 'newRequest' }
  }
  if (question) return { focus: previous, directive: 'question' }
  if (suppliedTitle) previous = { ...(previous.intent === 'event' ? previous : emptyFocus()), intent: 'event', title: suppliedTitle, kind: taskKind(suppliedTitle) === 'exam' ? 'exam' : eventKind(suppliedTitle) ?? 'protected', needsSubject: false }
  const rejected = !suppliedTitle ? userText.match(REJECT_KIND)?.[1]?.toLowerCase() : undefined
  if (rejected) {
    previous = { ...emptyFocus(), intent: 'event', rejected: [...new Set([...previous.rejected, rejected])] }
    userText = userText.replace(REJECT_KIND, '').replace(/^\s*(?:no|hindi)\b\s*[,;]?/i, '').replace(/^[\s,;.!?]*(?:(?:it is|it's|instead|but)\s+)?/i, '').trim()
    if (!userText) return { focus: previous, directive: 'correct' }
  }
  if (DECLINE.test(userText)) return { focus: emptyFocus(), directive: 'decline' }
  if (!suppliedTitle && REMOVE.test(userText)) return { focus: { ...previous, intent: 'remove' }, directive: 'continue' }
  if (!suppliedTitle && (STUDY.test(userText) || previous.intent === 'study')) {
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
  // "Name it dinner, not would like dinner", "call it Org meeting", "rename to Dinner" (speech-to-text: "name at dinner")
  const rename = !suppliedTitle && previous.intent === 'event' && !clockTime(userText) && !parseRange(userText, now)
    ? userText.match(/^\s*(?:no+[,.]?\s*)?(?:(?:please\s+)?(?:name|call|title|rename)\s+(?:it|at|this|that|the event)?\s*(?:to|as)?\s+|(?:it'?s|its|it is)\s+called\s+)(.+?)(?:[,.]?\s+(?:not|hindi)\s+.*)?[.!]?\s*$/i)
    : null
  if (rename) {
    const title = extractTitle(rename[1], '')
    if (title) return { focus: { ...previous, title, needsSubject: false, rejected: [...previous.rejected] }, directive: 'correct' }
  }
  if (!suppliedTitle && previous.intent === 'event' && previous.title && !clockTime(userText) && !parseRange(userText, now)) {
    // "It's not parts", "not parts", "hindi parts": those words come out of the title (speech-to-text heard "parts"
    // for "starts"). Back to the plain kind when nothing is left
    const not = userText.match(/^\s*(?:no+[,.]?\s*)?(?:it'?s\s+not|its\s+not|it\s+is\s+not|that'?s\s+not|not|hindi)\s+(?:a\s+|an\s+|the\s+|yung\s+|ang\s+)?(.+?)[.!]?\s*$/i)
    const drop = not ? not[1].toLowerCase().split(/[\s,]+/).filter((w) => w.length > 1 && !/^(it'?s|its|not|is|exam|quiz|test|event|meeting)$/.test(w)) : []
    if (drop.length) {
      const kept = previous.title.split(/\s+/).filter((w) => !drop.includes(w.toLowerCase())).join(' ').trim()
      const title = kept ? kept[0].toUpperCase() + kept.slice(1) : previous.kind === 'exam' ? 'Exam' : 'Event'
      // Already gone from the title: still a correction, remembered so it can't come back
      return { focus: { ...previous, title, needsSubject: GENERIC.test(title) && previous.needsSubject, rejected: [...new Set([...previous.rejected, ...drop])] }, directive: 'correct' }
    }
    if (not) return { focus: previous, directive: 'correct' } // "it's not it's not": a complaint, nothing to remove
    // "It's for bio", "subject is bio", "para sa bio", or just "bio" when Pal asked the subject
    const subject = GENERIC.test(previous.title)
      ? userText.match(/^\s*(?:it'?s\s+(?:for\s+)?|its\s+(?:for\s+)?|for\s+|(?:the\s+)?subject\s+is\s+|para\s+sa\s+)(?!not\b|hindi\b)([\p{L}][\p{L}\s.-]{1,30})[.!]?\s*$/iu)?.[1]
        // A short answer is a subject only if something is left once days and fillers go ("bukas pa naman" is a day)
        ?? (previous.needsSubject && /^\s*[\p{L}][\p{L}.-]*(?:\s+[\p{L}][\p{L}.-]*){0,2}[.!]?\s*$/u.test(userText) && !NOT_A_SUBJECT.test(userText) && namedDay(userText, now) == null && !MISHEARD_STARTS.test(userText) ? extractTitle(userText, '') || undefined : undefined)
      : undefined
    if (subject) {
      const kind = previous.title.toLowerCase()
      const title = `${subject.trim()[0].toUpperCase()}${subject.trim().slice(1)} ${kind}`
      return { focus: { ...previous, title, needsSubject: false }, directive: 'correct' }
    }
  }
  const kind = taskKind(userText) === 'exam' ? 'exam' : eventKind(userText) ?? (/\b(meeting|birthday|appointment|party)\b/i.test(userText) ? 'protected' : null)
  const day = namedDay(userText, now) ?? (/\blater\b/i.test(userText) && !isRelative(userText) ? startOfDay(now) : undefined)
  const range = parseRange(userText, now)
  const when = parseWhen(userText, now)
  const hasTime = !!(range || clockTime(userText) || (isRelative(userText) && when?.hadTime))
  if (previous.intent === 'remove' && !/\b(add|create|new|schedule|ilagay|lagay)\b/i.test(userText)) return { focus: previous, directive: 'continue' }
  const explicitlyNamed = !suppliedTitle && !!kind && !/\b(make it|change it|move it|gawin|ilipat)\b/i.test(userText)
  let focus = { ...previous, rejected: [...previous.rejected] }
  if (explicitlyNamed) {
    const title = extractTitle(userText.replace(/\blater\b/gi, ''), '')
    if (title) {
      // The same event, or a bare "Exam" getting its subject ("bio exam at 5pm"): keep its day and times
      const same = title.toLowerCase() === previous.title?.toLowerCase() || (previous.intent === 'event' && GENERIC.test(previous.title ?? '') && title.toLowerCase().endsWith(previous.title!.toLowerCase()))
      focus = { ...emptyFocus(), intent: 'event', title, kind, rejected: previous.rejected, needsSubject: GENERIC.test(title), ...(same ? { day: previous.day, start: previous.start, end: previous.end, awaitingEnd: previous.awaitingEnd } : {}) }
    }
  } else if (!suppliedTitle && previous.intent === 'event' && /\b(i have|may|meron|schedule|add)\b/i.test(userText) && !hasTime) {
    const title = extractTitle(userText.replace(/\blater\b/gi, ''), '')
    if (title) focus = { ...emptyFocus(), intent: 'event', title, kind: kind ?? 'protected' }
  } else if (!suppliedTitle && previous.intent === 'event' && !previous.title && hasTime) {
    const title = extractTitle(userText, '')
    if (title) focus = { ...focus, title, kind: kind ?? 'protected', needsSubject: false }
  } else if (!kind && day != null && !(previous.intent === 'event' && previous.title) && userText.trim().split(/\s+/).length <= 6 && !CHAT_LINE.test(userText)) {
    // "mall shopping tomorrow", "haircut sa sabado": an activity and a day, with no kind word the app knows. Still
    // something to add, so Pal asks the time itself (a small model only talked about it: "found a time…", no card)
    const title = extractTitle(userText.replace(/\blater\b/gi, ''), '')
    if (title && !GENERIC.test(title)) focus = { ...emptyFocus(), intent: 'event', title, kind: 'protected', rejected: previous.rejected }
  }
  if (focus.intent !== 'event') return { focus, directive: 'continue' }
  // Pal asked "what time does it end?": "5", "until 5:30", "2 hours", "30 mins" all answer it
  if (focus.awaitingEnd && focus.start != null && !range && day == null) {
    // "Skip", "di ko alam": they chose not to say, so a plain hour (never assumed without asking)
    const end = /^\s*(skip|idk|i don'?t know|not sure|no idea|di ko alam|hindi ko alam|ewan|bahala na|kahit ano)\b/i.test(userText) ? focus.start + HOUR : endFromAnswer(userText, focus.start)
    if (end != null) {
      focus.end = end
      delete focus.awaitingEnd
      return { focus, directive: 'continue' }
    }
  }
  if (day != null) {
    const delta = day - (focus.day ?? (focus.start ? startOfDay(focus.start) : day))
    focus.day = day
    if (focus.start != null) focus.start += delta
    if (focus.end != null) focus.end += delta
  }
  if (hasTime) {
    // A subject only when it's said with the kind word ("bio exam at 5pm"). "Parts on 5pm" is speech-to-text for
    // "starts on 5pm", not a subject
    // (or when Pal asked for the subject, minus words speech-to-text writes for "starts")
    if (!suppliedTitle && GENERIC.test(focus.title ?? '') && (/\b(exam|quiz|test|meeting|event)\b/i.test(userText) || previous.needsSubject)) {
      const title = extractTitle(userText.replace(MISHEARD_STARTS, ' ').replace(/\b(no|make|it|change|instead|dapat|will|would|it|this|that|ends?|ending|starts?|starting|begins?|is|at|on|from)\b/gi, ''), '')
      if (title && !/^(am|pm)$/i.test(title) && !GENERIC.test(title)) { focus.title = focus.kind === 'exam' && !/\b(exam|quiz)\b/i.test(title) ? `${title} exam` : title; focus.needsSubject = false }
    }
    if (focus.needsSubject) focus.needsSubject = false // asked once, with the time: a time-only answer keeps "Exam"
    const base = focus.day ?? startOfDay(now)
    if (range) {
      focus.start = base + range.start - startOfDay(range.start)
      focus.end = base + range.end - startOfDay(range.start)
      delete focus.awaitingEnd
    } else {
      // Moving an event that already has both ends keeps its length; a new one never gets a made-up end:
      // Pal asks "what time does it end?" (3pm is not 3–4pm)
      const length = focus.end != null && focus.start != null && !focus.awaitingEnd ? focus.end - focus.start : null
      const clock = clockTime(userText)
      const t = isRelative(userText) && when ? when.t : at(base, clock![0], clock![1])
      if (previous.awaitingEnd && previous.start != null && !isRelative(userText) && !/\b(no|hindi|instead|make|change|start)\b/i.test(userText)) {
        if (t > previous.start) { focus.end = t; delete focus.awaitingEnd }
      } else {
        focus.start = t
        if (length) { focus.end = t + length; delete focus.awaitingEnd }
        else { focus.end = undefined; focus.awaitingEnd = true }
      }
    }
    focus.day = startOfDay(focus.start!)
  }
  return { focus, directive: suppliedTitle || (hasTime && /\b(no|hindi|make|change|instead|dapat)\b/i.test(userText)) ? 'correct' : 'continue' }
}

/**
 * The answer to "what time does it end?" for an event starting at `start`: "5pm", "until 5", "5:30", "2 hours",
 * "30 mins". Null when it isn't one (or is a correction like "no, make it 4pm").
 */
export function endFromAnswer(text: string, start: number): number | null {
  if (/\b(no|hindi|instead|make|change|start)\b/i.test(text)) return null
  const bare = text.match(/^\s*(?:until|til|till|to|hanggang|up to)?\s*(\d{1,2})(?::(\d{2}))?\s*(?:na)?[.!\s]*$/i)
  const clock = clockTime(text) ?? (bare ? ([+bare[1], bare[2] ? +bare[2] : 0] as [number, number]) : null)
  const length = clock ? null : parseHours(text)
  let end = clock ? at(startOfDay(start), clock[0], clock[1]) : length ? start + length * HOUR : null
  // "until 5" after a 3pm start means 5pm
  if (end != null && clock && end <= start && clock[0] < 12) end += 12 * HOUR
  return end != null && end > start ? end : null
}

export function eventFromFocus(focus: ConversationFocus) {
  if (focus.intent !== 'event' || focus.awaitingEnd || !focus.title || focus.start == null || focus.end == null || focus.end <= focus.start) return null
  return { title: focus.title, kind: focus.kind ?? 'protected', start: focus.start, end: focus.end }
}

/**
 * The request being worked out, in plain words a small model reads reliably (a JSON blob made 9B models drift),
 * ending with the one thing to ask next
 */
export function describeFocus(focus: ConversationFocus) {
  if (focus.intent === 'none') return ''
  const when = (t: number) => `${fmtDay(t)} ${fmtTime(t)}`
  const rejected = focus.rejected.length ? ` The user corrected it: NOT ${focus.rejected.map((w) => `"${w}"`).join(', ')} (never use those).` : ''
  if (focus.intent === 'study') {
    const parts = [focus.title ? `subject "${focus.title}"` : 'subject unknown', focus.due ? `exam/deadline ${when(focus.due)}` : 'deadline unknown', focus.hours ? `${focus.hours}h${focus.perDay ? ' per day' : ' total'}` : 'hours unknown']
    const ask = !focus.title ? 'which subject' : !focus.due ? 'when the exam or deadline is' : !focus.hours ? 'how many hours to study' : ''
    return `CURRENT REQUEST (study plan): ${parts.join(', ')}.${rejected}${ask ? ` Ask ${ask}.` : ' Use findTime.'}`
  }
  if (focus.intent === 'remove') return `CURRENT REQUEST: remove something from the calendar${focus.title ? ` ("${focus.title}")` : ''}.`
  const parts = [
    focus.title ? `title "${focus.title}" (keep this exact title)` : 'title unknown',
    focus.start != null ? `starts ${when(focus.start)}` : focus.day != null ? `on ${fmtDay(focus.day)}, start time unknown` : 'day and start time unknown',
    focus.end != null && !focus.awaitingEnd ? `ends ${fmtTime(focus.end)}` : 'END TIME UNKNOWN',
  ]
  const ask = !focus.title ? 'what the event is' : focus.start == null ? (focus.needsSubject ? 'the subject and what time it starts' : 'what time it starts') : focus.end == null || focus.awaitingEnd ? 'what time it ends (never assume a length)' : ''
  return `CURRENT REQUEST (event): ${parts.join(', ')}.${rejected}${ask ? ` Ask ${ask}; action none.` : ' All details known: use addEvent.'}`
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
  const upcoming = datedTasks(tasks).filter((t) => t.due > now && (!key || matches(t.title)))
  if (!key && exams.length + upcoming.filter((t) => !exams.some((e) => e.taskId === t.id)).length !== 1) return null
  const exam = exams.sort((a, b) => a.start - b.start)[0]
  const task = upcoming.sort((a, b) => a.due - b.due)[0]
  const title = focus.title || exam?.title || task?.title
  const due = Math.min(...[focus.due, exam?.start, task?.due].filter((t): t is number => t != null && t > now))
  if (!title || !Number.isFinite(due)) return null
  return { title, due, hours: focus.hours, perDay: focus.perDay, task, exam, notBefore: focus.notBefore, replace: !!focus.replace }
}
