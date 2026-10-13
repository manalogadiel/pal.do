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
    // A reply cut off mid-JSON keeps its words, but never an action
    try { const r = await askGroq('review', 'jaypee', '', now, [], { full: '' }, false, { provider: 'local' }); return r === null || !r.action || r.action.type === 'none' }
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
  await check('a start time alone asks for the end instead of assuming an hour', async () => {
    const { emptyFocus, updateConversationFocus, eventFromFocus } = await import('./conversation')
    let focus = updateConversationFocus(emptyFocus(), 'Bio exam Friday 3pm', now).focus
    if (!focus.awaitingEnd || eventFromFocus(focus) || focus.title !== 'Bio exam') return false
    focus = updateConversationFocus(focus, '5pm', now).focus
    const event = eventFromFocus(focus)
    return event?.title === 'Bio exam' && event.end - event.start === 2 * 3_600_000
  })
  await check('a length or a bare hour answers "until when?"', async () => {
    const { emptyFocus, updateConversationFocus, eventFromFocus } = await import('./conversation')
    const gym = updateConversationFocus(emptyFocus(), 'gym tomorrow 6pm', now).focus
    if (!gym.awaitingEnd || gym.end != null) return false
    const hour = eventFromFocus(updateConversationFocus(gym, '1 hour', now).focus)
    const until = eventFromFocus(updateConversationFocus(gym, 'until 8', now).focus)
    return hour?.start === at(day + 86400000, 18) && hour.end === at(day + 86400000, 19) && until?.end === at(day + 86400000, 20)
  })
  await check('chit-chat while asking the end keeps the event title', async () => {
    const { emptyFocus, updateConversationFocus, eventFromFocus } = await import('./conversation')
    let focus = updateConversationFocus(emptyFocus(), 'Bio exam Friday 3pm', now).focus
    for (const text of ['hmm wait', 'thank you', 'ang dami kong gagawin', 'ok']) focus = updateConversationFocus(focus, text, now).focus
    return eventFromFocus(updateConversationFocus(focus, '8pm', now).focus)?.title === 'Bio exam'
  })
  await check('moving an event that has both ends keeps its length', async () => {
    const { emptyFocus, updateConversationFocus, eventFromFocus } = await import('./conversation')
    let focus = updateConversationFocus(emptyFocus(), 'seminar tomorrow 3-5pm', now).focus
    focus = updateConversationFocus(focus, 'no, make it 4pm', now).focus
    const event = eventFromFocus(focus)
    return event?.start === at(day + 86400000, 16) && event.end === at(day + 86400000, 18)
  })
  await check('the rules ask the end too, then make the card', async () => {
    const { turn } = await import('./agent')
    const first = turn('lagay mo bukas 3pm study', { pal: 'rei', now, draft: null, awaiting: null })
    if (first.action || !first.pending?.needsEnd) return false
    const second = turn('5pm', { pal: 'rei', now, draft: null, awaiting: null, pending: first.pending })
    return second.action?.type === 'addEvent' && second.action.end === at(day + 86400000, 17)
  })
  await check('the model brief says plainly what is missing', async () => {
    const { emptyFocus, updateConversationFocus, describeFocus } = await import('./conversation')
    const brief = describeFocus(updateConversationFocus(emptyFocus(), 'Bio exam Friday 3pm', now).focus)
    return brief.includes('"Bio exam"') && brief.includes('END TIME UNKNOWN') && !brief.includes('{')
  })
  await check('the local prompt asks before assuming and keeps nicknames', async () => {
    const { generateLocalSystemPrompt } = await import('./groq')
    const prompt = generateLocalSystemPrompt('jhyvie', now, undefined, '')
    return /never assume an end time/i.test(prompt) && /never the user's/i.test(prompt) && prompt.includes('Anong oras matatapos')
  })
  await check('"noted" with no card counts as a claim', () => sanitizeAi({ text: "I've noted your Bio exam on Friday at 3 PM!", action: { type: 'none' } }, 'Bio exam Friday 3pm', now)?.claimed === 'add')
  await check('Whisper spellings of "Hi {pal}" wake it, everyday sentences do not', async () => {
    const { matchWake } = await import('./wake')
    const wakes = [['rei', 'Hirei, add gym'], ['rei', 'I, Ray. Set a timer'], ['rei', 'Hi, Re.'], ['diel', 'Hi, Dale.'], ['diel', 'Heydiel set a timer'], ['jhyvie', 'HiJV']] as const
    const quiet = [['diel', 'I deal with it'], ['rei', 'I really want coffee'], ['diel', 'I dial my mom'], ['rei', 'Hello there']] as const
    return wakes.every(([pal, t]) => matchWake(t, pal)) && quiet.every(([pal, t]) => !matchWake(t, pal)) && matchWake('I, Ray. Set a timer', 'rei')?.command === 'set a timer'
  })
  await check("Jhyvie never calls the user by her own nickname", async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify({ message: { content: JSON.stringify({ text: "Hi JV! Kaya mo 'yan, sige JV!", action: { type: 'none' } }) } }))) as typeof fetch
    try {
      const r = await askGroq('kumusta', 'jhyvie', '', now, [], { full: '' }, false, { provider: 'local' })
      return r != null && !/\bjv\b/i.test(r.text)
    } finally { globalThis.fetch = original }
  })
  await check('the spoken dinner chat: request words, a rename, "start at", "ends at"', async () => {
    const { emptyFocus, updateConversationFocus, eventFromFocus } = await import('./conversation')
    let focus = emptyFocus()
    for (const text of ['I would like to schedule a dinner', 'Name at dinner not would like dinner', 'It was start at 7 PM', 'Hands at 9 PM']) focus = updateConversationFocus(focus, text, now).focus
    const event = eventFromFocus(focus)
    return event?.title === 'Dinner' && event.start === at(day, 19) && event.end === at(day, 21)
  })
  await check('"call it …" renames the event being set up, without a time', async () => {
    const { updateConversationFocus } = await import('./conversation')
    const r = updateConversationFocus({ intent: 'event', title: 'Would like dinner', start: at(day, 19), rejected: [] }, 'no, call it family dinner', now)
    return r.focus.title === 'Family dinner' && r.focus.start === at(day, 19)
  })
  await check('the overlapped study block is named for the AI', () => {
    const facts = buildContext(now, [], [], null, {}, { card: { type: 'event', title: 'Dinner', start: at(day, 19), end: at(day, 21), blocked: ['Reflection, 7pm–8pm'] } })
    return facts.full.includes('Reflection, 7pm–8pm')
  })
  await check('event titles drop how it was said ("I\'m going to", "it is", "I will attend")', async () => {
    const { extractTitle } = await import('./parse')
    return extractTitle("I'm going to my friend's birthday party on Saturday", '') === "Friend's birthday party"
      && extractTitle('it is my cousin birthday party', '') === 'Cousin birthday party'
      && extractTitle('I will attend the birthday party of Ana tomorrow 5pm', '') === "Ana's birthday party"
  })
  await check("the model's cleaner title for the same event is kept", async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify({ message: { content: JSON.stringify({ text: "Ana's birthday party, 5–8pm. Add it?", action: { type: 'addEvent', title: "Ana's birthday party", kind: 'protected', start: '2026-10-13T17:00:00', end: '2026-10-13T20:00:00' } }) } }))) as typeof fetch
    try {
      const r = await askGroq('5 to 8pm', 'rei', '', now, [], { full: '' }, false, { provider: 'local', focus: { intent: 'event', title: 'Will attend birthday party Ana', day: day + 86400000, start: at(day + 86400000, 17), end: at(day + 86400000, 20), rejected: [] } })
      return r?.action?.title === "Ana's birthday party"
    } finally { globalThis.fetch = original }
  })
  await check('"parts on 5pm" (speech-to-text for "starts") never becomes the exam\'s title', async () => {
    const { emptyFocus, updateConversationFocus } = await import('./conversation')
    let focus = updateConversationFocus(emptyFocus(), 'i have an exam tomorrow', now).focus
    focus = updateConversationFocus(focus, 'parts on 5:00 p.m.', now).focus
    return focus.title === 'Exam' && focus.start === at(day + 86400000, 17) && !!focus.awaitingEnd
  })
  await check('"it\'s not parts" takes the word out of the title and counts as a correction', async () => {
    const { updateConversationFocus } = await import('./conversation')
    const r = updateConversationFocus({ intent: 'event', title: 'Parts exam', kind: 'exam', start: at(day + 86400000, 17), awaitingEnd: true, rejected: [] }, "it's not parts", now)
    const again = updateConversationFocus(r.focus, "it's not it's not", now)
    return r.directive === 'correct' && r.focus.title === 'Exam' && r.focus.rejected.includes('parts') && again.directive === 'correct' && again.focus.title === 'Exam'
  })
  await check('a bare exam takes its subject from "bio", "it\'s for math" or "bio exam at 5pm", never from a day', async () => {
    const { emptyFocus, updateConversationFocus } = await import('./conversation')
    const exam = updateConversationFocus(emptyFocus(), 'i have an exam tomorrow', now).focus
    const day2 = updateConversationFocus(exam, 'bukas pa naman', now).focus
    return updateConversationFocus(exam, 'bio', now).focus.title === 'Bio exam'
      && updateConversationFocus(exam, "it's for math", now).focus.title === 'Math exam'
      && updateConversationFocus(exam, 'bio exam at 5pm', now).focus.title === 'Bio exam'
      && day2.title === 'Exam'
  })
  await check('"skip" for the end time blocks an hour only because they said so', async () => {
    const { updateConversationFocus, eventFromFocus } = await import('./conversation')
    const event = eventFromFocus(updateConversationFocus({ intent: 'event', title: 'Exam', kind: 'exam', start: at(day, 17), day, awaitingEnd: true, rejected: [] }, 'skip', now).focus)
    return event?.end === at(day, 18)
  })
  await check('a clash keeps the dinner and moves the bus; fixed things never move', async () => {
    const { clashes, resolveClash } = await import('./schedule')
    const E = (id: string, title: string, kind: CalEvent['kind'], h1: number, h2: number): CalEvent => ({ id, title, kind, start: at(day, h1), end: at(day, h2), status: 'planned' })
    const events = [E('bus', 'Bus home', 'commute', 19, 20), E('class', 'Calc II', 'class', 10, 12), E('shift', 'Cafe shift', 'shift', 13, 15)]
    const dinner = { start: at(day, 19), end: at(day, 21) }
    const moved = resolveClash(dinner, 'protected', clashes([dinner], events), events, now)
    const gym = { start: at(day, 10), end: at(day, 11) }
    const exam = { start: at(day, 13), end: at(day, 14) }
    return moved?.event.id === 'bus' && moved.to.start >= dinner.end
      && resolveClash(gym, 'protected', clashes([gym], events), events, now) === null
      && resolveClash(exam, 'exam', clashes([exam], events), events, now) === null
  })
  await check('nowhere to move the gym that day: shorten it instead of stacking', async () => {
    const { clashes, resolveClash } = await import('./schedule')
    const busy = (id: string, h1: number, h2: number): CalEvent => ({ id, title: 'Shift ' + id, kind: 'shift', start: at(day, h1), end: at(day, h2), status: 'planned' })
    const gym: CalEvent = { id: 'gym', title: 'Gym', kind: 'work', start: at(day, 16), end: at(day, 17), status: 'planned' }
    const events = [busy('a', 5, 16), gym, busy('b', 17, 23)]
    const meeting = { start: at(day, 16, 30), end: at(day, 17) }
    const r = resolveClash(meeting, 'protected', clashes([meeting], events), events, now)
    return r?.trimmed === true && r.event.id === 'gym' && r.to.start === at(day, 16) && r.to.end === at(day, 16, 30)
  })
  await check('schedule questions are answered from the calendar and never become events', async () => {
    const { parseScheduleQuestion, answerScheduleQuestion } = await import('./schedule-answers')
    const { emptyFocus, updateConversationFocus } = await import('./conversation')
    const exam: CalEvent = { id: 'x', title: 'Bio exam', kind: 'exam', start: at(day + 86400000, 15), end: at(day + 86400000, 17), status: 'planned' }
    const ask = (t: string) => { const q = parseScheduleQuestion(t, now); return q ? answerScheduleQuestion(q, { events: [exam], tasks: [], now }) : '' }
    const focus = updateConversationFocus(emptyFocus(), 'do i have an exam tomorrow', now)
    return /Yes.*Bio exam 3pm/.test(ask('do i have an exam tomorrow')) && /Yes.*Bio exam/.test(ask("no i'm asking if i have an exam tomorrow"))
      && /Bio exam.*in/.test(ask('when is my bio exam?')) && /left before Bio exam/.test(ask('how much time do i have before my bio exam'))
      && focus.directive === 'question' && focus.focus.intent === 'none'
      && parseScheduleQuestion('can you add gym at 5pm tomorrow?', now) === null && parseScheduleQuestion('what schedule do you suggest for this', now) === null
  })
  await check('academic work is declined on every model; normal chat is not filtered', async () => {
    const { turn } = await import('./agent')
    const ctx = { pal: 'rei' as const, now, draft: null, awaiting: null }
    return turn("what's 17 x 23", ctx).rule === 'Scope filter: no academic work' && turn('can you explain photosynthesis', ctx).rule === 'Scope filter: no academic work'
      && !/academic/.test(turn('recommend a netflix show', ctx).rule ?? '')
  })
  await check('insights: short sleep, a shift over dinner, an exam with no plan; never about feelings', async () => {
    const { dayInsights, weekInsights } = await import('./insights')
    const D = 86400000
    const E = (id: string, title: string, kind: CalEvent['kind'], d: number, h1: number, h2: number): CalEvent => ({ id, title, kind, start: at(day + d * D, h1), end: at(day + d * D, h2), status: 'planned' })
    const events = [E('shift', 'Cafe shift', 'shift', 1, 16, 23), E('class', 'Calc II', 'class', 2, 5, 7), E('a', 'Org', 'protected', 1, 9, 12), E('b', 'Lab', 'class', 1, 12, 16)]
    const tasks = [{ id: 't', title: 'Bio exam', kind: 'exam' as const, due: at(day + 3 * D, 15), hours: 4, doneHours: 0 }]
    const found = dayInsights(day + D, events, tasks, now).map((i) => i.kind)
    const all = weekInsights(events, tasks, now).map((i) => i.text).join(' ')
    const longShiftOnly = dayInsights(day + D, [E('s', 'Cafe shift', 'shift', 1, 9, 17)], [], now).filter((i) => i.kind === 'noBreak')
    return found.includes('shortSleep') && found.includes('noMeal') && found.includes('noPlan') && /Grab something before/.test(all)
      && !/stress|burn|anxi|depress/i.test(all) && longShiftOnly.length === 0
  })
  // The question bank (docs/assistant-questions.md): each phrasing lands on the right instant answer, or goes to the model
  const bank: [string, string | null][] = [
    ['what are my plans today', 'day'], ['what are my plans tomorrow?', 'day'], ['what do i have on friday?', 'day'], ['anong sched ko bukas?', 'day'],
    ['do i have an exam tomorrow', 'day'], ['do i have class on thursday', 'day'], ['may exam ba ako bukas?', 'day'], ["no, i'm asking if i have an exam tomorrow", 'day'],
    ['what are my free time today', 'free'], ['when am i free tonight?', 'free'], ['am i free at 3pm tomorrow?', 'freeAt'], ['when am i free for 2 hours this week?', 'freeFor'], ['may bakante ba ako mamayang gabi?', 'free'],
    ["what's my next schedule", 'next'], ['what are my next schedules', 'next'], ['ano susunod ko', 'next'], ['what should i be doing right now?', 'now'],
    ['when is my bio exam?', 'when'], ['how much time do i have left before the rizal paper', 'countdown'], ['how many days until my midterms?', 'countdown'], ['ilang araw na lang bago ang finals', 'countdown'],
    ["what's due this week?", 'due'], ["what's my closest deadline?", 'due'], ['how busy is my week?', 'week'], ["what's my heaviest day?", 'week'],
    ['any bad habits?', 'insights'], ['am i on track?', 'insights'], ['am i overloaded this week?', 'insights'], ["how's my week looking?", 'insights'],
    ['what schedule do you suggest for this', null], ['when should i start my paper?', null], ['can i fit a 1-hour gym session today?', null], ['move my gym to 7pm', null],
    ['cancel my org meeting', null], ['hi jp', null], ['recommend a netflix show', null], ['i have an exam tomorrow', null], ['gym tomorrow 6pm', null],
  ]
  for (const [text, want] of bank) {
    await check(`question bank: "${text}" → ${want ?? 'model'}`, async () => {
      const { parseScheduleQuestion } = await import('./schedule-answers')
      return (parseScheduleQuestion(text, now)?.type ?? null) === want
    })
  }
  return failures
}
