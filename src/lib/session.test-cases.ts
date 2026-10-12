// Pomodoro session model regression net. Run by `pnpm eval:chat` (scripts/eval-chat.mjs).
import { alarmMode, eventAlarmId, isReservedAlarmId, makeSerial, SESSION_ALARM_ID, SESSION_ALARM_IDS } from './alarmIds'
import { makeChime } from './chime'
import { focusElapsed, fromSaved, FOCUS_MS, IDLE, pause, phaseEnds, phaseLabel, remaining, resume, skip, start, stop, tick, type Session } from './session'

const MIN = 60_000

export async function runSessionTests(): Promise<string[]> {
  const fails: string[] = []
  const eq = (name: string, got: unknown, want: unknown) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
  }
  const pick = (s: Session) => ({ phase: s.phase, round: s.round, phaseEndsAt: s.phaseEndsAt, completedFocusMs: s.completedFocusMs })

  const s0 = start(0)
  eq('start', pick(s0), { phase: 'focus', round: 1, phaseEndsAt: 25 * MIN, completedFocusMs: 0 })
  eq('start remaining', remaining(s0, 0), FOCUS_MS)
  eq('focus→break', pick(tick(s0, 25 * MIN)), { phase: 'break', round: 1, phaseEndsAt: 30 * MIN, completedFocusMs: 25 * MIN })
  eq('break→focus r2', pick(tick(s0, 30 * MIN)), { phase: 'focus', round: 2, phaseEndsAt: 55 * MIN, completedFocusMs: 25 * MIN })
  // r4 focus 90–115, long break 115–130
  const r4 = tick(s0, 116 * MIN)
  eq('long break', [r4.phase, r4.round, phaseLabel(r4), r4.phaseEndsAt], ['break', 4, 'Long break', 130 * MIN])
  // A long break that ends on its own closes the set, so a forgotten timer can't log hours of fake focus
  eq('after long break', pick(tick(s0, 130 * MIN)), { phase: 'idle', round: 1, phaseEndsAt: 0, completedFocusMs: 100 * MIN })
  eq('forgotten 24h credits one set only', pick(tick(s0, 24 * 60 * MIN)), { phase: 'idle', round: 1, phaseEndsAt: 0, completedFocusMs: 100 * MIN })
  eq('skip long break keeps going', pick(skip(r4, 117 * MIN)), { phase: 'focus', round: 1, phaseEndsAt: 142 * MIN, completedFocusMs: 100 * MIN })
  eq('ancient phaseEndsAt is bounded', pick(tick(fromSaved({ ...s0, phaseEndsAt: 0 }), 1e12)), { phase: 'idle', round: 1, phaseEndsAt: 0, completedFocusMs: 100 * MIN })
  eq('jump 2h', pick(tick(s0, 120 * MIN)), { phase: 'break', round: 4, phaseEndsAt: 130 * MIN, completedFocusMs: 100 * MIN })

  const p = pause(s0, 10 * MIN)
  eq('pause left', p.pausedLeft, 15 * MIN)
  eq('paused tick is frozen', tick(p, 999 * MIN), p)
  eq('paused remaining', remaining(p, 999 * MIN), 15 * MIN)
  const r = resume(p, 60 * MIN)
  eq('resume', [r.phaseEndsAt, r.pausedLeft], [75 * MIN, undefined])

  eq('skip focus credits elapsed', pick(skip(s0, 10 * MIN)), { phase: 'break', round: 1, phaseEndsAt: 15 * MIN, completedFocusMs: 10 * MIN })
  const b = tick(s0, 26 * MIN)
  eq('skip break', pick(skip(b, 27 * MIN)), { phase: 'focus', round: 2, phaseEndsAt: 52 * MIN, completedFocusMs: 25 * MIN })
  eq('skip paused focus', pick(skip(pause(s0, 5 * MIN), 40 * MIN)), { phase: 'break', round: 1, phaseEndsAt: 45 * MIN, completedFocusMs: 5 * MIN })
  eq('idle tick', tick(IDLE, 5 * MIN), IDLE)
  eq('stop', stop(), IDLE)

  // Stopping mid-focus still counts the minutes actually focused
  eq('focusElapsed running', focusElapsed(s0, 20 * MIN), 20 * MIN)
  eq('focusElapsed paused', focusElapsed(pause(s0, 7 * MIN), 99 * MIN), 7 * MIN)
  eq('focusElapsed on break', focusElapsed(tick(s0, 26 * MIN), 27 * MIN), 0)
  eq('focusElapsed idle', focusElapsed(IDLE, 5 * MIN), 0)

  // A corrupt or missing save never crashes the tab; it just becomes idle
  eq('fromSaved missing', fromSaved(undefined), IDLE)
  eq('fromSaved junk', fromSaved({ phase: 'focus', phaseEndsAt: 'soon' }), IDLE)
  eq('fromSaved bad phase', fromSaved({ ...s0, phase: 'nap' }), IDLE)
  eq('fromSaved valid', fromSaved(JSON.parse(JSON.stringify(p))), p)

  // Calendar alarm ids must never collide with the reserved session alarm id
  for (const id of ['a', 'zzzzzzzzzz', 'k3j4h5', '0000000', 'event-with-a-long-id-1234567890']) {
    const n = eventAlarmId(id)
    if (!(n >= 1 && n < 900_000)) fails.push(`eventAlarmId(${id}) = ${n} outside 1..899999`)
  }
  eq('eventAlarmId stable', eventAlarmId('abc'), eventAlarmId('abc'))
  eq('session id reserved', SESSION_ALARM_ID, 900001)

  // Every remaining phase end of the set gets its own alarm, so background Android still hears "break's over"
  const ends = (s: Session, now: number) => phaseEnds(s, now).map((e) => [e.at / MIN, e.phase, e.round])
  eq('phaseEnds from start', ends(s0, 0), [[25, 'focus', 1], [30, 'break', 1], [55, 'focus', 2], [60, 'break', 2], [85, 'focus', 3], [90, 'break', 3], [115, 'focus', 4], [130, 'break', 4]])
  eq('phaseEnds mid-set', ends(tick(s0, 100 * MIN), 100 * MIN), [[115, 'focus', 4], [130, 'break', 4]])
  eq('phaseEnds paused', phaseEnds(p, 0), [])
  eq('phaseEnds idle', phaseEnds(IDLE, 0), [])
  eq('alarm block fits a whole set', SESSION_ALARM_IDS.length >= phaseEnds(s0, 0).length, true)
  eq('alarm block ids', [SESSION_ALARM_IDS[0], SESSION_ALARM_IDS.every(isReservedAlarmId)], [900001, true])
  eq('event ids not reserved', isReservedAlarmId(eventAlarmId('zzzzzzzzzz')), false)

  // A running timer must never open OS permission/settings screens on its own
  eq('alarmMode no permission', alarmMode(false, 'granted'), 'off')
  eq('alarmMode exact', alarmMode(true, 'granted'), 'exact')
  eq('alarmMode exact denied', alarmMode(true, 'denied'), 'inexact')
  eq('alarmMode exact unknown', alarmMode(true, undefined), 'inexact')

  // One shared AudioContext, resumed inside a tap, so browsers let the chime play later from a timer
  let made = 0, resumed = 0, beeps = 0
  class FakeAudio {
    state = 'suspended'
    currentTime = 0
    destination = {}
    constructor() { made++ }
    resume() { resumed++; this.state = 'running'; return Promise.resolve() }
    createOscillator() { beeps++; return { frequency: { value: 0 }, connect: (n: unknown) => n, start() {}, stop() {} } }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (n: unknown) => n } }
  }
  const chime = makeChime(() => FakeAudio as unknown as new () => AudioContext)
  chime.unlock()
  chime.play()
  chime.play()
  eq('chime one shared context', made, 1)
  eq('chime resumed in the tap', resumed, 1)
  eq('chime: the alarm melody is four notes per play', beeps, 8)
  // Alarm ops run in call order: a quick Pause must not finish before the Start's slower arming
  const order: string[] = []
  const serial = makeSerial()
  serial(() => new Promise<void>((ok) => setTimeout(() => { order.push('arm'); ok() }, 20)))
  await serial(async () => { order.push('cancel') })
  eq('alarm ops keep call order', order, ['arm', 'cancel'])
  const afterFailure: string[] = []
  serial(async () => { throw new Error('plugin failed') })
  await serial(async () => { afterFailure.push('ran') })
  eq('alarm ops continue after a failure', afterFailure, ['ran'])
  eq('chime without audio support is silent', (() => { try { makeChime(() => undefined).play(); return 'ok' } catch { return 'threw' } })(), 'ok')
  return fails
}
