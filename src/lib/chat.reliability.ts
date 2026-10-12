import { buildContext } from './context'
import { at, type CalEvent } from './core'
import { askGroq, sanitizeAi, useLocalAiForEval } from './groq'
import { parseWhen } from './parse'
import type { ConversationFocus } from './conversation'

export async function runChatReliabilityTests() {
  const failures: string[] = []
  const check = async (name: string, body: () => unknown) => {
    try { if (!await body()) failures.push(name) } catch (error) { failures.push(`${name}: ${String(error)}`) }
  }
  const day = new Date(2026, 9, 12).getTime()
  const now = at(day, 8, 54)
  const blocks: CalEvent[] = [
    { id: 'old1', title: 'App Dev exam', kind: 'work', taskId: 'exam-task', status: 'proposed', start: at(day, 9), end: at(day, 10, 15) },
    { id: 'exam', title: 'App Dev exam', kind: 'exam', taskId: 'exam-task', status: 'planned', start: at(day + 86400000, 16), end: at(day + 86400000, 18) },
  ]
  await check('visible proposed review blocks have references and status', () => {
    const facts = buildContext(now, blocks, [], null)
    return Object.values(facts.refs).includes('old1') && /proposed.*review|review.*proposed/i.test(facts.full)
  })
  await check('exam task facts retain the exact deadline clock time', () => {
    const facts = buildContext(now, [], [{ id: 't', title: 'App Dev exam', kind: 'exam', due: at(day + 86400000, 16), hours: 2, doneHours: 0 }], null)
    return facts.full.includes('4pm')
  })
  await check('non-string model text is rejected without crashing', () => sanitizeAi({ text: { bad: true } as unknown as string }, 'hi', now) === null)
  await check('forced local calls never contact the cloud even with a key', async () => {
    const original = globalThis.fetch
    const urls: string[] = []
    useLocalAiForEval('http://localhost:11434', 'test:0.5b')
    globalThis.fetch = (async (input: RequestInfo | URL) => { urls.push(String(input)); return new Response('{}', { status: 503 }) }) as typeof fetch
    try {
      await askGroq('hi', 'jaypee', 'test-key', now, [], { full: '' }, false, { provider: 'local' })
      return urls.length > 0 && urls.every((url) => url.startsWith('http://localhost:11434/'))
    } finally { globalThis.fetch = original }
  })
  await check('forced cloud calls never fall back to a local model', async () => {
    const original = globalThis.fetch
    const urls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => { urls.push(String(input)); return new Response('{}', { status: 503 }) }) as typeof fetch
    try {
      await askGroq('hi', 'jaypee', 'test-key', now, [], { full: '' }, false, { provider: 'cloud' })
      return urls.length > 0 && urls.every((url) => !url.includes('localhost:11434'))
    } finally { globalThis.fetch = original }
  })
  await check('offline corrections start a seminar today without stale exam details', async () => {
    const { emptyFocus, updateConversationFocus, eventFromFocus } = await import('./conversation')
    let focus = { ...emptyFocus(), intent: 'event' as const, title: 'App Dev exam', kind: 'exam' as const, day: day + 86400000 }
    let result = updateConversationFocus(focus, 'No, I want to schedule a new one', now)
    if (result.directive !== 'newRequest' || result.focus.title || result.focus.day) return false
    result = updateConversationFocus(result.focus, 'not an exam', now)
    if (!result.focus.rejected.includes('exam') || result.focus.kind === 'exam') return false
    result = updateConversationFocus(result.focus, 'no', now)
    if (result.directive !== 'decline') return false
    result = updateConversationFocus(result.focus, 'i have seminar later', now)
    if (result.focus.title !== 'Seminar' || result.focus.day !== day || result.focus.start) return false
    result = updateConversationFocus(result.focus, '3–5pm', now)
    const event = eventFromFocus(result.focus)
    return event?.title === 'Seminar' && event.start === at(day, 15) && event.end === at(day, 17)
  })
  await check('a greeting preserves pending data but never schedules an old exam', async () => {
    const { emptyFocus, updateConversationFocus } = await import('./conversation')
    const result = updateConversationFocus({ ...emptyFocus(), title: 'App Dev exam' }, 'Hi jp', now)
    return result.directive === 'greeting' && result.focus.title === 'App Dev exam'
  })
  await check('a replacement time corrects rather than cancels a pending event', async () => {
    const { emptyFocus, updateConversationFocus } = await import('./conversation')
    const result = updateConversationFocus({ ...emptyFocus(), intent: 'event', title: 'Seminar', day }, 'no, make it 3pm', now)
    return result.directive === 'correct' && result.focus.start === at(day, 15)
  })
  await check('old study group selection preserves the actual exam and newer review', async () => {
    const { selectStudyGroup } = await import('./conversation')
    const old = [9, 10, 11, 12].map((hour, i) => ({ ...blocks[0], id: `old${i + 1}`, start: at(day, hour), end: at(day, hour + 1) }))
    const newer = { ...blocks[0], id: 'new', status: 'planned' as const, start: at(day, 14), end: at(day, 15) }
    const result = selectStudyGroup('remove the 4 app dev exam from the previous', [...old, newer, blocks[1]], [old.map((e) => e.id), ['new']])
    return result?.length === 4 && result.every((e) => e.kind === 'work' && e.id.startsWith('old'))
  })
  await check('local replies contradicting a rejected interpretation are not displayed', async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify({ message: { content: JSON.stringify({ text: "Let's schedule your App Dev exam tomorrow.", action: { type: 'none' } }) } }))) as typeof fetch
    try {
      const response = await askGroq('not an exam', 'jaypee', '', now, [], { full: '' }, false, { provider: 'local', focus: { intent: 'event', rejected: ['exam'] } })
      return response === null
    } finally { globalThis.fetch = original }
  })
  await check('malformed local replies are rejected with no calendar action', async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify({ message: { content: '{"text":42,"action":{"type":"addEvent"}}' } }))) as typeof fetch
    try { return await askGroq('hi', 'jaypee', '', now, [], { full: '' }, false, { provider: 'local' }) === null }
    finally { globalThis.fetch = original }
  })
  await check('later means today without inventing a clock time', () => {
    const parsed = parseWhen('i have seminar later', now)
    return !!parsed && new Date(parsed.t).getDate() === 12 && !parsed.hadTime
  })
  await check('group confirmation removes exactly the preview and rejects stale targets', async () => {
    const { removePreviewedEvents } = await import('./conversation')
    const next = removePreviewedEvents(blocks, [blocks[0]])
    const stale = removePreviewedEvents(blocks, [{ ...blocks[0], start: at(day, 10) }])
    return next?.length === 1 && next[0].id === 'exam' && stale === null
  })
  await check('ambiguous groups never select an arbitrary plan', async () => {
    const { selectStudyGroup } = await import('./conversation')
    const second = { ...blocks[0], id: 'old2' }
    return selectStudyGroup('remove previous study blocks', [...blocks, second], [['old1'], ['old2']]) === null
  })
  await check('those review sessions selects the single previewed group', async () => {
    const { selectStudyGroup } = await import('./conversation')
    const selected = selectStudyGroup('remove those review sessions', blocks, [['old1']])
    return selected?.length === 1 && selected[0].id === 'old1'
  })
  await check('exam range and later correction keep the explicitly named subject', async () => {
    const { emptyFocus, updateConversationFocus, eventFromFocus } = await import('./conversation')
    const first = updateConversationFocus(emptyFocus(), 'I have exam tomorrow', now)
    const second = updateConversationFocus(first.focus, '4pm bukas app dev', now)
    const final = updateConversationFocus(second.focus, '4-6pm', now)
    const event = eventFromFocus(final.focus)
    return event?.title === 'App dev exam' && event.start === at(day + 86400000, 16) && event.end === at(day + 86400000, 18)
  })
  await check('review hours are separate from exam duration and finish before its start', async () => {
    const { emptyFocus, updateConversationFocus, resolveStudyRequest } = await import('./conversation')
    const exam = blocks[1]
    let focus: ConversationFocus = { ...emptyFocus(), title: exam.title, kind: 'exam', start: exam.start, end: exam.end }
    focus = updateConversationFocus(focus, 'then lets remake the study sessions', now).focus
    focus = updateConversationFocus(focus, '2hrs until before exam', now).focus
    const request = resolveStudyRequest(focus, blocks, [], now)
    return request?.hours === 2 && request.due === exam.start && request.replace === true
  })
  await check('named study subjects replace earlier subjects even with a duration', async () => {
    const { updateConversationFocus } = await import('./conversation')
    const focus = updateConversationFocus({ intent: 'none', title: 'App Dev exam', kind: 'exam', start: blocks[1].start, rejected: [] }, 'review Biology exam for 2 hours', now).focus
    return focus.title === 'Biology' && focus.hours === 2 && focus.due == null
  })
  await check('daily study hours retain daily intent', async () => {
    const { emptyFocus, updateConversationFocus, resolveStudyRequest } = await import('./conversation')
    const focus = updateConversationFocus(emptyFocus(), 'study 2 hours every day before my App Dev exam', now).focus
    return focus.title === 'App Dev' && resolveStudyRequest(focus, blocks, [], now)?.perDay === 2
  })
  await check('deadline corrections are not interpreted as study start times', async () => {
    const { updateConversationFocus } = await import('./conversation')
    const focus = updateConversationFocus({ intent: 'study', title: 'App Dev', due: blocks[1].start, rejected: [] }, 'actually the exam is Friday at 4pm', now).focus
    return focus.due === at(day + 4 * 86400000, 16) && focus.notBefore == null
  })
  await check('replacement event details survive a negative correction', async () => {
    const { emptyFocus, updateConversationFocus } = await import('./conversation')
    const focus = updateConversationFocus(emptyFocus(), 'not an exam, it is a seminar at 3pm', now).focus
    return focus.title === 'Seminar' && focus.start === at(day, 15) && focus.rejected.includes('exam')
  })
  await check('model actions cannot borrow a different event from older history', async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify({ message: { content: JSON.stringify({ text: 'App Dev exam tomorrow, 4–6pm.', action: { type: 'addEvent', title: 'App Dev exam', kind: 'exam', start: '2026-10-13T16:00:00', end: '2026-10-13T18:00:00' } }) } }))) as typeof fetch
    try {
      return await askGroq('2 hours', 'jaypee', '', now, [{ role: 'user', content: 'App Dev exam tomorrow 4-6pm' }], { full: '' }, false, { provider: 'local', focus: { intent: 'event', title: 'Seminar', day, rejected: [] } }) === null
    } finally { globalThis.fetch = original }
  })
  await check('study on a named day does not start on an earlier day', async () => {
    const { updateConversationFocus } = await import('./conversation')
    const focus = updateConversationFocus({ intent: 'study', title: 'App Dev', due: blocks[1].start, rejected: [] }, 'study tomorrow for 2 hours', now).focus
    return focus.notBefore === day + 86400000 && focus.title === 'App Dev'
  })
  await check('polite study requests keep their named subject', async () => {
    const { updateConversationFocus } = await import('./conversation')
    const focus = updateConversationFocus({ intent: 'study', title: 'App Dev', due: blocks[1].start, rejected: [] }, 'Can you help me review App Dev exam for 2 hours?', now).focus
    return focus.title === 'App Dev' && focus.due === blocks[1].start
  })
  await check('a leading no does not become part of a replacement event title', async () => {
    const { emptyFocus, updateConversationFocus } = await import('./conversation')
    const focus = updateConversationFocus(emptyFocus(), 'No, not an exam, it is a seminar at 3pm', now).focus
    return focus.title === 'Seminar' && focus.start === at(day, 15)
  })
  await check('relevant review and exam references survive a crowded calendar', () => {
    const other = Array.from({ length: 12 }, (_, i) => ({ ...blocks[1], id: `other${i}`, title: 'Other meeting', kind: 'protected' as const, start: at(day, 9) + i * 60000, end: at(day, 10) + i * 60000 }))
    const facts = buildContext(now, [...other, ...blocks], [], null, {}, { focusTitle: 'App Dev exam' })
    return Object.values(facts.refs).includes('old1') && Object.values(facts.refs).includes('exam') && facts.full.includes('limited list')
  })
  await check('invalid local JSON cannot become a calendar action', async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify({ message: { content: '{"text":"Plan ready",' } }))) as typeof fetch
    try { return await askGroq('review', 'jaypee', '', now, [], { full: '' }, false, { provider: 'local' }) === null }
    finally { globalThis.fetch = original }
  })
  await check('old Ollama servers retry JSON once with the same validation', async () => {
    const original = globalThis.fetch
    const formats: unknown[] = []
    useLocalAiForEval('http://schema-test.invalid', 'test:0.5b')
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/api/show')) return new Response(JSON.stringify({ capabilities: ['completion'] }))
      const body = JSON.parse(String(init?.body))
      formats.push(body.format)
      if (formats.length === 1) return new Response('unsupported format schema', { status: 400 })
      return new Response(JSON.stringify({ message: { content: JSON.stringify({ text: 'Hello! How can I help?', action: { type: 'none' } }) } }))
    }) as typeof fetch
    try {
      const response = await askGroq('hi', 'jaypee', '', now, [], { full: '' }, false, { provider: 'local' })
      return response?.action?.type === 'none' && formats.length === 2 && typeof formats[0] === 'object' && formats[1] === 'json'
    } finally { globalThis.fetch = original; useLocalAiForEval('http://localhost:11434', 'test:0.5b') }
  })
  await check('an exam start followed by an end does not become study hours', async () => {
    const { emptyFocus, updateConversationFocus, eventFromFocus } = await import('./conversation')
    let focus = updateConversationFocus(emptyFocus(), 'I have App Dev exam tomorrow', now).focus
    focus = updateConversationFocus(focus, '4pm', now).focus
    if (!focus.awaitingEnd || eventFromFocus(focus)) return false
    focus = updateConversationFocus(focus, '6pm', now).focus
    const event = eventFromFocus(focus)
    return event?.start === blocks[1].start && event.end === blocks[1].end
  })

  // Phone transcripts, Oct 12: "Exam e", "Exam tom", "bukas pa naman", two bubbles, the bus under an exam
  await check('Taglish fillers and "tom" never end up in an event title', async () => {
    const { emptyFocus, updateConversationFocus } = await import('./conversation')
    const a = updateConversationFocus(emptyFocus(), 'May exam ako e', now).focus
    const b = updateConversationFocus(emptyFocus(), 'May Exam ako tom', now).focus
    const { extractTitle, namedDay } = await import('./parse')
    return a.title === 'Exam' && b.title === 'Exam' && b.day === day + 86400000
      && extractTitle('dinner with Tom tomorrow', '') === 'Dinner with Tom' && namedDay('dinner with Tom', now) == null
      && extractTitle('E-commerce exam friday', '') === 'E-commerce exam'
  })
  await check('"bukas pa naman" after "what time?" keeps the exam and sets tomorrow', async () => {
    const { emptyFocus, updateConversationFocus } = await import('./conversation')
    let focus = updateConversationFocus(emptyFocus(), 'May exam ako e', now).focus
    focus = updateConversationFocus(focus, 'Bukas pa naman', now).focus
    return focus.intent === 'event' && focus.title === 'Exam' && focus.day === day + 86400000 && focus.start == null
  })
  await check('calling a pal by another pal\'s name is caught, and the request survives', async () => {
    const { wrongPal } = await import('./wake')
    const hi = wrongPal('Hi Jhyvie', 'rei')
    const ask = wrongPal('jv, add exam tomorrow 4:30pm', 'rei')
    const tail = wrongPal('add my exam tomorrow, jhyvie', 'diel')
    return hi?.wrong === 'Jhyvie' && hi.rest === '' && ask?.rest === 'add exam tomorrow 4:30pm' && tail?.rest === 'add my exam tomorrow'
      && wrongPal('Hi Rei', 'rei') === null && wrongPal('ok deal', 'rei') === null && wrongPal('hi jv', 'jhyvie') === null
  })
  await check('hands-free: "hey jhyvie" while Rei listens is a wrong name; everyday words are not', async () => {
    const { wakesOtherPal } = await import('./wake')
    const heard = wakesOtherPal('Hey Jhyvie, set a timer for 10 seconds.', 'rei')
    return heard?.wrong === 'Jhyvie' && heard.command === 'set a timer for 10 seconds'
      && wakesOtherPal('okay deal', 'jhyvie') === null && wakesOtherPal('hey ray', 'jhyvie') === null
      && wakesOtherPal('hi rei what time is it', 'rei') === null && wakesOtherPal('hi diel', 'jhyvie')?.wrong === 'Diel'
  })
  await check('a bus ride under an exam is offered a move to right after it', async () => {
    const { moveAside } = await import('./schedule')
    const bus: CalEvent = { id: 'bus', title: 'Bus home', kind: 'commute', status: 'planned', start: at(day + 86400000, 17), end: at(day + 86400000, 17, 45) }
    const exam = { start: at(day + 86400000, 16), end: at(day + 86400000, 18) }
    const r = moveAside(exam, [bus], [bus], now)
    const notCommute = moveAside(exam, [{ ...bus, kind: 'class' }], [bus], now)
    // A 6pm gym right after: the ride goes after the gym, never before the exam
    const gym: CalEvent = { id: 'gym', title: 'Gym', kind: 'protected', status: 'planned', start: at(day + 86400000, 18), end: at(day + 86400000, 19) }
    const afterGym = moveAside(exam, [bus], [bus, gym], now)
    return r?.event.id === 'bus' && r.to.start === exam.end && r.to.end === at(day + 86400000, 18, 45) && notCommute === null
      && afterGym?.to.start === at(day + 86400000, 19)
  })
  await check('a phone-model reply the guards turn down is "rejected", not "could not finish"', async () => {
    const { getNativeFailure } = await import('./groq')
    const nativeClient = { generate: async () => JSON.stringify({ text: 'Sure, I can help you schedule the exam start time for tomorrow,', action: { type: 'addEvent', title: 'Exam', start: '2026-10-13T09:00:00', end: '2026-10-13T10:00:00' } }) }
    const focus: ConversationFocus = { intent: 'event', title: 'Exam', kind: 'exam', day: day + 86400000, rejected: [] }
    const r = await askGroq('Can you add it?', 'rei', '', now, [], { full: '' }, false, { provider: 'native', focus, nativeClient })
    return r === null && getNativeFailure() === 'REJECTED'
  })
  await check('AI modes pick the right brain on a computer', async () => {
    const { chooseProvider } = await import('./groq')
    return chooseProvider('online') === 'cloud' && chooseProvider('offline') === 'local' && chooseProvider('auto') === 'auto'
  })
  await check('only Jhyvie is prompted and scripted in Taglish', async () => {
    const { generateSystemPrompt } = await import('./groq')
    const { say } = await import('./agent')
    const taglish = /\b(sige|ayan|kaya|tara|anong|oras|ilalagay|bukas|naman|muna)\b/i
    const english = (['rei', 'diel', 'jaypee'] as const).every((p) => generateSystemPrompt(p, now).includes('English only') && !generateSystemPrompt(p, now).includes('Ayan, sige') && !taglish.test(say(p, 'unknown', { next: 'your week' })) && !taglish.test(say(p, 'askStart', { what: 'Exam' })) && !taglish.test(say(p, 'chatAck')))
    return english && generateSystemPrompt('jhyvie', now).includes('Ayan, sige') && taglish.test(say('jhyvie', 'askStart', { what: 'Exam' }))
  })
  return failures
}
