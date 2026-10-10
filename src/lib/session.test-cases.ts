// Pomodoro session model regression net. Run by `pnpm eval:chat` (scripts/eval-chat.mjs).
import { eventAlarmId, SESSION_ALARM_ID } from './alarmIds'
import { focusElapsed, fromSaved, FOCUS_MS, IDLE, pause, phaseLabel, remaining, resume, skip, start, stop, tick, type Session } from './session'

const MIN = 60_000

export function runSessionTests(): string[] {
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
  eq('after long break', pick(tick(s0, 130 * MIN)), { phase: 'focus', round: 1, phaseEndsAt: 155 * MIN, completedFocusMs: 100 * MIN })
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
  return fails
}
