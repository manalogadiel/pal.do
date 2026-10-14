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
  assert.equal(cleanSpeech('May 4 tasks ka, 25 minutes. At 4 hanggang 6.', 'jhyvie'), 'May 4 tasks ka, 25 minutes. At 4 hanggang 6.', 'Never guess a period for ambiguous numbers')
  const overnight = answerScheduleQuestion({type:'day',day:at(0),label:'today'}, {events:[{...events[0],start:at(23),end:at(1,0,15)}],tasks:[],now,taglish:true})
  assert.ok(overnight.includes('11 PM–1 AM') && overnight.includes('Thu'), 'Overnight ranges include the following date')
  for (const prompt of [generateSystemPrompt('jhyvie', now), localFixedPrompt('jhyvie')]) assert.ok(prompt.includes('AM/PM on both ends'), 'Cloud and local models receive the same clock-time rule')
  writeFileSync('/tmp/paldo-schedule-speech-sample.json', JSON.stringify({pal:'jhyvie',text:cleanSpeech('May dinner ka mamayang 4 PM–6 PM. Cafe shift ng 6 PM–10 PM, at Wanted ng 9:30 PM–10 PM. Ang lunch mo ay 12 PM, at midnight ay 12 AM.', 'jhyvie')}))
  console.log('schedule speech: exact Tagalog calendar answers, AM/PM, English clock words, noon, midnight, overnight, and prompts pass')
} finally { await vite.close() }
