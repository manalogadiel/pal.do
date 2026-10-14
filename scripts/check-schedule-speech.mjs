import { createServer } from 'vite'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
const vite = await createServer({ configLoader: 'runner', server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
try {
  const { parseScheduleQuestion, answerScheduleQuestion } = await vite.ssrLoadModule('/src/lib/schedule-answers.ts')
  const { cleanSpeech } = await vite.ssrLoadModule('/src/lib/speech-profile.ts')
  const { generateSystemPrompt, localFixedPrompt } = await vite.ssrLoadModule('/src/lib/groq.ts')
  assert.equal(cleanSpeech('Hi Pol! Your meeting is at 7 AM.', 'rei'), 'Hi, Paul! Your meeting is at seven A. M..')
  const now = new Date(2026, 9, 14, 14).getTime()
  const at = (hour, minute = 0, day = 14) => new Date(2026, 9, day, hour, minute).getTime()
  const events = [
    { id: 'dinner', title: 'Mean dinner', start: at(16), end: at(18), kind: 'protected', status: 'planned' },
    { id: 'shift', title: 'Cafe shift', start: at(18), end: at(22), kind: 'shift', status: 'planned' },
    { id: 'wanted', title: 'Wanted', start: at(21, 30), end: at(22), kind: 'protected', status: 'planned' },
  ]
  const q = parseScheduleQuestion('anong mga plano ko today', now)
  assert.equal(q?.type, 'day', 'The screenshot question must use exact calendar facts, not model paraphrasing')
  const reply = answerScheduleQuestion(q, { events, tasks: [], now, taglish: true })
  for (const range of ['4 PM–6 PM', '6 PM–10 PM', '9:30 PM–10 PM']) assert.ok(reply.includes(range), `Explicit AM/PM at both ends: ${range}`)
  const spoken = cleanSpeech(reply, 'jhyvie')
  for (const range of ['four pee em hanggang six pee em', 'six pee em hanggang ten pee em', 'nine thirty pee em hanggang ten pee em']) assert.ok(spoken.includes(range), `English spoken times: ${range}`)
  assert.equal(cleanSpeech('12 PM at 12 AM', 'jhyvie'), 'twelve ng tanghali at twelve ng madaling araw')
  assert.equal(cleanSpeech('12:00pm to 12:00am', 'rei'), 'twelve noon to twelve midnight')
  assert.equal(cleanSpeech('12 PM', 'jhyvie', true), 'twelve noon', 'An explicit English request stays English')
  assert.equal(cleanSpeech('7:05 AM–9:30 AM', 'jhyvie'), 'seven oh five ey em hanggang nine thirty ey em')
  assert.equal(cleanSpeech('4 PM - 6 PM', 'rei'), 'four P. M. to six P. M.')
  assert.equal(cleanSpeech('May 4 tasks ka, 25 minutes. At 4 hanggang 6.', 'jhyvie'), 'May 4 tasks ka, twenty five minutes. At 4 hanggang 6.', 'Never guess a period for ambiguous numbers')
  for (const pal of ['rei', 'diel', 'jhyvie', 'jaypee']) {
    assert.equal(cleanSpeech('Meeting at 8:00.', pal), "Meeting at eight o'clock.", `${pal}: a bare clock is not read as punctuation`)
    assert.equal(cleanSpeech('8:05 and 13:30', pal), `eight oh five and one thirty ${pal === 'jhyvie' ? 'pee em' : 'P. M.'}`, `${pal}: interpret unambiguous 24-hour afternoon times`)
    assert.equal(cleanSpeech('20:00 and 00:05', pal), `eight ${pal === 'jhyvie' ? 'pee em' : 'P. M.'} and twelve oh five ${pal === 'jhyvie' ? 'ey em' : 'A. M.'}`, `${pal}: 24-hour evening and midnight minutes`)
    assert.equal(cleanSpeech('12:00', pal), "twelve o'clock", `${pal}: do not guess noon or midnight without a period`)
    assert.equal(cleanSpeech('8:00–9:30', pal), `eight o'clock ${pal === 'jhyvie' ? 'hanggang' : 'to'} nine thirty`, `${pal}: bare clock ranges`)
    assert.equal(cleanSpeech('Focus 25m, break 1m, booked 1h 30m.', pal), 'Focus twenty five minutes, break one minute, booked one hour thirty minutes.', `${pal}: compact planner durations`)
    assert.equal(cleanSpeech('2h15m', pal), 'two hours fifteen minutes', `${pal}: adjacent hour and minute units`)
    assert.equal(cleanSpeech('0m and 1 min', pal), 'zero minutes and one minute', `${pal}: zero and singular minutes`)
    assert.equal(cleanSpeech('8:00 AM and 8:05 PM', pal), `eight ${pal === 'jhyvie' ? 'ey em' : 'A. M.'} and eight oh five ${pal === 'jhyvie' ? 'pee em' : 'P. M.'}`, `${pal}: preserve the AM/PM letter pronunciation`)
    assert.equal(cleanSpeech('Wait 25 m, then study for 90 minutes.', pal), 'Wait twenty five minutes, then study for ninety minutes.', `${pal}: spaced time units and explicit minutes`)
    assert.equal(cleanSpeech('539 min and 1.5 hours', pal), 'five hundred thirty nine minutes and one point five hours', `${pal}: long and fractional durations`)
    assert.equal(cleanSpeech('A 5m cable, 5 m of rope, walk 10m, 20 m/s, and 4 m².', pal), 'A 5m cable, 5 m of rope, walk 10m, 20 m/s, and 4 m².', `${pal}: measurement units are not minutes`)
    assert.equal(cleanSpeech('The room is 5m by 3m. Height 2m.', pal), 'The room is 5m by 3m. Height 2m.', `${pal}: dimensions and measured height`)
    assert.equal(cleanSpeech('Room 800, version 8:99, code A8:00B.', pal), 'Room 800, version 8:99, code A8:00B.', `${pal}: invalid clocks and identifiers stay unchanged`)
  }
  const overnight = answerScheduleQuestion({type:'day',day:at(0),label:'today'}, {events:[{...events[0],start:at(23),end:at(1,0,15)}],tasks:[],now,taglish:true})
  assert.ok(overnight.includes('11 PM–1 AM') && overnight.includes('Thu'), 'Overnight ranges include the following date')
  for (const prompt of [generateSystemPrompt('jhyvie', now), localFixedPrompt('jhyvie')]) assert.ok(prompt.includes('AM/PM on both ends'), 'Cloud and local models receive the same clock-time rule')
  writeFileSync('/tmp/paldo-schedule-speech-sample.json', JSON.stringify({pal:'jhyvie',text:cleanSpeech('May dinner ka mamayang 4 PM–6 PM. Cafe shift ng 6 PM–10 PM, at Wanted ng 9:30 PM–10 PM. Ang lunch mo ay 12 PM, at midnight ay 12 AM.', 'jhyvie')}))
  console.log('schedule speech: exact Tagalog calendar answers, AM/PM, English clock words, noon, midnight, overnight, and prompts pass')
} finally { await vite.close() }
