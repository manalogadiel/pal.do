// Voice timers, device commands and the wake phrase. Run by `pnpm eval:chat` (scripts/eval-chat.mjs).
import { parseCommand, parseDuration } from './commands'
import { addReminder, addTime, cancelTimer, fmtLeft, NO_ALARMS, pauseTimer, resumeTimer, sayLength, startTimer, tickAlarms, timeLeft, upcomingAlarms } from './timers'
import { isEcho, matchWake, soundKey } from './wake'

const S = 1000
const MIN = 60 * S

export function runVoiceTests(): string[] {
  const fails: string[] = []
  const eq = (name: string, got: unknown, want: unknown) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
  }

  /* ---------- durations ---------- */
  eq('5 mins', parseDuration('5 mins'), 300)
  eq('5mins', parseDuration('timer for 5mins'), 300)
  eq('1 min 30 sec', parseDuration('1 min 30 sec'), 90)
  eq('30 segundo', parseDuration('30 segundo'), 30)
  eq('limang minuto', parseDuration('limang minuto'), 300)
  eq('kalahating oras', parseDuration('kalahating oras'), 1800)
  eq('half an hour', parseDuration('half an hour'), 1800)
  eq('five minutes (spoken)', parseDuration('five minutes'), 300)
  eq('forty five minutes', parseDuration('forty five minutes'), 2700)
  eq('"3 am" is not a minute', parseDuration('remind me at 3 am'), null)
  eq('"as soon as" is not a second', parseDuration('as soon as possible'), null)

  /* ---------- commands ---------- */
  const NOW = new Date(2026, 9, 12, 14, 0).getTime()
  eq('the ask: timer 5 mins, warn last 30s', parseCommand('set me a timer for 5mins and remind me last 30 seconds', NOW), { type: 'setTimer', seconds: 300, warnSeconds: 30 })
  eq('spoken numbers', parseCommand('set a timer for five minutes and remind me the last thirty seconds', NOW), { type: 'setTimer', seconds: 300, warnSeconds: 30 })
  eq('warn before it ends', parseCommand('10 minute timer, warn me 1 minute before it ends', NOW), { type: 'setTimer', seconds: 600, warnSeconds: 60 })
  eq('Taglish timer', parseCommand('i-timer mo ng 5 minuto, paalala sa huling 30 segundo', NOW), { type: 'setTimer', seconds: 300, warnSeconds: 30 })
  eq('plain timer', parseCommand('timer 25 mins', NOW), { type: 'setTimer', seconds: 1500 })
  const r = parseCommand('remind me in 20 mins to drink water', NOW)
  eq('reminder in 20 mins', r && r.type === 'setReminder' ? [r.at - NOW, r.text] : r, [20 * MIN, 'Drink water'])
  const r3 = parseCommand('remind me at 3pm to call mom', NOW)
  eq('reminder at 3pm', r3 && r3.type === 'setReminder' ? [new Date(r3.at).getHours(), r3.text] : r3, [15, 'Call mom'])
  eq('reminder with no time → chat handles it', parseCommand('remind me to study', NOW), null)
  const rt = parseCommand('pakisabihan mo ako mamayang 3pm na mag-review', NOW)
  eq('Taglish reminder', rt && rt.type === 'setReminder' ? [new Date(rt.at).getHours(), rt.text] : rt, [15, 'Review'])
  eq('start focus', parseCommand('start focus', NOW), { type: 'study', op: 'start' })
  eq('"start studying friday 3pm" is planning', parseCommand('start studying friday 3pm', NOW), null)
  eq('time left on a timer', parseCommand('how much time left?', NOW, { timers: true }), { type: 'timer', op: 'left' })
  eq('time left in focus', parseCommand('how long left', NOW, { study: 'running' }), { type: 'study', op: 'left' })
  eq('add 2 minutes', parseCommand('add 2 minutes', NOW, { timers: true }), { type: 'timer', op: 'add', seconds: 120 })
  eq('pause the timer', parseCommand('pause the timer', NOW, { timers: true, study: 'running' }), { type: 'timer', op: 'pause' })
  eq('pause focus', parseCommand('pause focus', NOW, { timers: true, study: 'running' }), { type: 'study', op: 'pause' })
  eq('skip break', parseCommand('skip the break', NOW, { study: 'running' }), { type: 'study', op: 'skip' })
  eq('cancel with nothing running → chat', parseCommand('cancel that', NOW), null)
  eq('"cancel that" with a card waiting → the card, not the timer', parseCommand('cancel that', NOW, { timers: true, cardWaiting: true }), null)
  eq("what's next", parseCommand("what's next?", NOW), { type: 'next' })
  eq('ano meron ngayon', parseCommand('ano meron ako ngayon', NOW), { type: 'next' })
  eq('a planning message is not a command', parseCommand('add mo gym bukas 6pm', NOW, { timers: true }), null)
  eq('whats my name', parseCommand('whats my name', NOW), { type: 'whoami' })
  eq('wats my name (typo)', parseCommand('wats my name?', NOW), { type: 'whoami' })
  eq('ano pangalan ko', parseCommand('ano pangalan ko', NOW), { type: 'whoami' })
  eq('sino ako', parseCommand('jv sino ako?', NOW), { type: 'whoami' })
  eq('"ano pangalan mo" asks the pal, not a command', parseCommand('ano pangalan mo', NOW), null)

  /* ---------- timers model ---------- */
  let a = startTimer(NO_ALARMS, 300, 0, { warnSeconds: 30 })
  const id = a.timers[0].id
  eq('ends and warns', [a.timers[0].endsAt, a.timers[0].warnAt], [300 * S, 270 * S])
  eq('nothing due early', tickAlarms(a, 100 * S).alerts.length, 0)
  let tk = tickAlarms(a, 271 * S)
  eq('warning fires once', tk.alerts.map((x) => x.kind), ['warn'])
  eq('warning not twice', tickAlarms(tk.next, 272 * S).alerts.length, 0)
  tk = tickAlarms(tk.next, 300 * S)
  eq('then done', tk.alerts.map((x) => x.kind), ['done'])
  // A phone that slept through both: one "done", no stale "30 seconds left"
  eq('slept past the end → done only', tickAlarms(a, 999 * S).alerts.map((x) => x.kind), ['done'])
  const p = pauseTimer(a, id, 100 * S)
  eq('paused keeps time', timeLeft(p.timers[0], 500 * S), 200 * S)
  eq('paused never fires', tickAlarms(p, 999 * S).alerts.length, 0)
  const rs = resumeTimer(p, id, 1000 * S)
  eq('resume shifts end and warning', [rs.timers[0].endsAt, rs.timers[0].warnAt], [1200 * S, 1170 * S])
  const plus = addTime(a, id, 120, 50 * S)
  eq('add 2 minutes', [plus.timers[0].endsAt, plus.timers[0].warnAt], [420 * S, 390 * S])
  eq('warning past its time is dropped', startTimer(NO_ALARMS, 20, 0, { warnSeconds: 30 }).timers[0].warnAt, undefined)
  eq('cancel', cancelTimer(a, id).timers.length, 0)
  eq('max 3 timers', [1, 2, 3, 4].reduce((acc) => startTimer(acc, 60, 0), NO_ALARMS).timers.length, 3)
  a = addReminder(NO_ALARMS, 60 * S, 'Drink water')
  eq('reminder fires', tickAlarms(a, 61 * S).alerts.map((x) => (x.kind === 'remind' ? x.reminder.text : x.kind)), ['Drink water'])
  eq('fired reminder is cleared', tickAlarms(a, 61 * S).next.reminders.length, 0)
  const up = upcomingAlarms(startTimer(addReminder(NO_ALARMS, 500 * S, 'Call mom'), 300, 0, { warnSeconds: 30 }), 0).map((x) => [x.kind, x.at])
  eq('native alarm list', up, [['warn', 270 * S], ['done', 300 * S], ['remind', 500 * S]])
  eq('fmtLeft', [fmtLeft(65 * S), fmtLeft(30 * S), fmtLeft(3725 * S)], ['1:05', '0:30', '1:02:05'])
  eq('sayLength', [sayLength(300), sayLength(30), sayLength(90)], ['5 minutes', '30 seconds', '1 minute 30 seconds'])

  /* ---------- wake phrase ---------- */
  eq('the ask', matchWake('Hi Jhyvie, set me a timer for 5 minutes and remind me the last 30 seconds.', 'jhyvie'), { command: 'set me a timer for 5 minutes and remind me the last 30 seconds' })
  eq('hey JV', matchWake('Hey JV.', 'jhyvie'), { command: '' })
  eq('hi Jivi', matchWake("Hi Jivi, what's next?", 'jhyvie'), { command: 'whats next' })
  eq('uh hi Jayvee', matchWake('Uh, hi Jayvee', 'jhyvie'), { command: '' })
  eq('hi jay vee (two words)', matchWake('hi jay vee start focus', 'jhyvie'), { command: 'start focus' })
  eq('one letter off', matchWake('hi jyvie start focus', 'jhyvie'), { command: 'start focus' })
  // What Whisper actually wrote when Kokoro said "Hi Jhyvie" (the audio self-test)
  eq('heard as "Jay Highby"', matchWake('Hi Jay Highby. Set me a timer for five minutes and remind me the last 30 seconds.', 'jhyvie'), { command: 'set me a timer for five minutes and remind me the last 30 seconds' })
  eq('heard as "Jay Hivey"', matchWake("Hi Jay Hivey, what's next?", 'jhyvie'), { command: 'whats next' })
  eq('heard as "Hi, Jay Hivey."', matchWake('Hi, Jay Hivey. Set me a timer', 'jhyvie'), { command: 'set me a timer' })
  eq('"hi jay" alone is not Jhyvie', matchWake('hi jay how you doing', 'jhyvie'), null)
  eq('sound keys', ['Jay Hivey', 'Jayvee', 'Jhyvie', 'JV'].map(soundKey), ['jaivi', 'jaivi', 'jivi', 'jv'])
  eq('Jaypee as jp', matchWake('hey jp timer 5 mins', 'jaypee'), { command: 'timer 5 mins' })
  eq('Rei as Ray', matchWake('hi ray', 'rei'), { command: '' })
  eq('no greeting → no wake', matchWake('jv set a timer', 'jhyvie'), null)
  eq('other words → no wake', matchWake('hi guys', 'jhyvie'), null)
  eq('another pal → no wake', matchWake('hi Jhyvie', 'rei'), null)
  eq('the user\'s own name never wakes', matchWake('hi ray', 'rei', 'Ray'), null)
  eq('mid-sentence name → no wake', matchWake('I told jv hi', 'jhyvie'), null)

  /* ---------- interrupting Pal: its own voice heard back is not "Hi Jhyvie" ---------- */
  const GREET = 'Hiii, Jhyvie here! Kwento mo naman your week, classes, deadlines, raket, lahat.'
  eq('Pal\'s greeting heard back → echo', isEcho('Hi, Jhyvie here. Kwento mo naman your week.', GREET, 'jhyvie'), true)
  eq('a piece of it → echo', isEcho('Hi Jhyvie here', GREET, 'jhyvie'), true)
  eq('"Hi Jhyvie stop" over the greeting → interrupt', isEcho('Hi Jhyvie stop', GREET, 'jhyvie'), false)
  eq('"Hi Jhyvie, what\'s next?" over a line about next → interrupt', isEcho("Hi Jhyvie, what's next?", 'Next up: Bio class at 3pm.', 'jhyvie'), false)
  eq('bare "Hi Jhyvie" over a line without it → interrupt', isEcho('Hi Jhyvie', 'Sige! 5 minutes na timer, simula na.', 'jhyvie'), false)
  eq('nothing being said → never an echo', isEcho('Hi Jhyvie stop', '', 'jhyvie'), false)
  return fails
}
